const { getCloudFrontDomainName } = require("./cloudFront");
const {getCertificateArn, requestCertificateWithDNS} = require("./acm");

const getHostedZoneForDomain = async (awsClient, domainName) => {
    const r53response = await awsClient.request('Route53', 'listHostedZones', {}),
        hostedZone = r53response.HostedZones
            .find(hostedZone => `${domainName}.`.includes(hostedZone.Name));

    //if (!hostedZone) throw `Domain is not managed by AWS, you will have to add a record for ${domainName} manually.`;

    return hostedZone;
};

const checkChangeStatus = async (awsClient, changeInfo) => {
    const getChangeParams = {
            Id: changeInfo.Id
        },
        getChangeResponse = await awsClient.request('Route53', 'getChange', getChangeParams);

    return getChangeResponse.ChangeInfo.Status === 'INSYNC';
};

const waitForChange = async (checkChange) => {
    const isChangeComplete = await checkChange();

    if (isChangeComplete) {
        return isChangeComplete
    } else {
        await new Promise(r => setTimeout(r, 1000));
        return await waitForChange(checkChange);
    }
};

const filterExistingAlias = async (awsClient, hostedZone, target) => {
    const requestParams = {
            HostedZoneId: hostedZone.Id
        },
        r53response = await awsClient.request('Route53', 'listResourceRecordSets', requestParams),
        sets = r53response.ResourceRecordSets,
        filteredDomains = hostedZone.domains.filter(domain => !sets.find(set => set.Name === `${domain}.` && set.AliasTarget?.DNSName === `${target}.`))
        
    return {...hostedZone, domains: filteredDomains};
};

const groupDomainsByHostedZone = async (awsClient, domains) =>
    // Get hosted Zone for each domain, group domains by HZ.Id using .reduce and extract values
    Object.values(
        await domains.reduce(async (promisedAccumulator, domain) => {
            const hostedZones = await promisedAccumulator;
            const hostedZone = await getHostedZoneForDomain(awsClient, domain);
            if (hostedZones[hostedZone?.Id]) hostedZones[hostedZone?.Id].domains.push(domain);
            else hostedZones[hostedZone?.Id] = {...hostedZone, domains: [domain]};
            return hostedZones;
        }, {})
    );

const addCloudFrontAlias = async (serverless, domains) => {
    if (!Array.isArray(domains)) {
        domains = [domains];
    }

    const awsClient = serverless.getProvider('aws'),
        target = await getCloudFrontDomainName(serverless),
        domainsByHostedZones = await groupDomainsByHostedZone(awsClient, domains),
        domainsWithoutHostedZone = domainsByHostedZones
                .filter(hostedZone => !hostedZone.Id)
                .reduce((acc, hostedZone) => [...acc, ...hostedZone.domains],[]),
        filteredDomainsByHostedZones = (await Promise.all(domainsByHostedZones
                .filter(hostedZone => !!hostedZone.Id)
                .map(hostedZone => filterExistingAlias(awsClient, hostedZone, target))))
                .filter(hostedZone => hostedZone.domains.length);

    if (domainsWithoutHostedZone?.length > 0) 
        serverless.cli.log(`No hosted zones found for ${domainsWithoutHostedZone}, records pointing to`
                            +` ${target} will have to be added manually.`, "Route53", {color: "orange", underline: true});
    
    await Promise.all(filteredDomainsByHostedZones.map(async hostedZone => {
        hostedZone.domains.forEach(domain => 
            serverless.cli.log(`Adding ALIAS record for ${domain} to point to ${target}...`)
        );
        
        const changeRecordParams = {
                HostedZoneId: hostedZone.Id,
                ChangeBatch: {
                    Changes: hostedZone.domains.map(domainName => (
                        {
                            Action: 'UPSERT',
                            ResourceRecordSet: {
                                Name: domainName,
                                Type: 'A',
                                AliasTarget: {
                                    HostedZoneId: 'Z2FDTNDATAQYW2', // global CloudFront HostedZoneId
                                    DNSName: target,
                                    EvaluateTargetHealth: false
                                }
                            }
                        }
                    ))
                }
            },
            changeRecordResult = await awsClient.request('Route53', 'changeResourceRecordSets', changeRecordParams);
    
        // wait for DNS entry
        await waitForChange(() => checkChangeStatus(awsClient, changeRecordResult.ChangeInfo));

        serverless.cli.log(`ALIAS ${hostedZone.domains} -> ${target} successfully added.`);

        // waitFor can't be called using Provider.request yet
        /*
        waitForRecordParams = {
            Id: changeRecordResult.ChangeInfo.Id
        },

        {err, waitForRecordResult} = await awsClient.request('Route53', 'waitFor', 'resourceRecordSetsChanged', waitForRecordParams)
        */
    }));
};

const groupResourceRecordsByHostedZone = async (awsClient, resourceRecords) =>
    // Get hosted Zone for each resourcerecord, group resourcerecords by HZ.Id using .reduce and extract values
    Object.values(
        await resourceRecords.reduce(async (promisedAccumulator, resourceRecord) => {
            const hostedZones = await promisedAccumulator;
            const hostedZone = await getHostedZoneForDomain(awsClient, resourceRecord.Name);
            if (hostedZones[hostedZone?.Id]) hostedZones[hostedZone?.Id].resourceRecords.push(resourceRecord);
            else hostedZones[hostedZone?.Id] = {...hostedZone, resourceRecords: [resourceRecord]};
            return hostedZones;
        }, {})
    );

const setupCertificate = async (serverless, domains) => {
    const existingCertificateArn = await getCertificateArn(serverless, domains);
    if (existingCertificateArn) {
        return existingCertificateArn;
    }

    if (!Array.isArray(domains)) {
        domains = [domains];
    }

    serverless.cli.log(`Requesting certificate for ${domains}...`);

    const awsClient = serverless.getProvider('aws'),
        getCertificateRecords = async (serverless, domains) => {
            const certificaterequest = await requestCertificateWithDNS(serverless, domains),
                resourceRecords = certificaterequest.DomainValidationOptions
                        .filter(validationOption => validationOption.ValidationStatus !== "SUCCESS")
                        .map(validationOption => validationOption.ResourceRecord);
            return resourceRecords.every(e => !!e) && resourceRecords.length === domains.length ? resourceRecords : null
        },
        // sometimes the ResourceRecords entries aren't immediately available, so we wait until they are
        certificateResourceRecords = await waitForChange(() => getCertificateRecords(serverless, domains)),
        resourceRecordsByHostedZones = await groupResourceRecordsByHostedZone(awsClient, certificateResourceRecords),
        resourceRecordsWithoutHostedZone = resourceRecordsByHostedZones
                .filter(hostedZone => !hostedZone.Id)
                .reduce((acc, hostedZone) => [...acc, ...hostedZone.resourceRecords],[]),
        filteredResourceRecordsByHostedZones = resourceRecordsByHostedZones.filter(hostedZone => !!hostedZone.Id);

    resourceRecordsWithoutHostedZone.forEach((resourceRecord) => {
      serverless.cli.log(
        `Needs to be added manually: ${resourceRecord.Type} ${resourceRecord.Name} ${resourceRecord.Value}`,
        "Route53",
        { color: "orange", underline: true }
      );
    });

    await Promise.all(filteredResourceRecordsByHostedZones.map(async hostedZone => {
        const changeRecordParams = {
                HostedZoneId: hostedZone.Id,
                ChangeBatch: {
                    Changes: hostedZone.resourceRecords.map(resourceRecord => (
                        {
                            Action: 'UPSERT',
                            ResourceRecordSet: {
                                Name: resourceRecord.Name,
                                Type: resourceRecord.Type,
                                TTL: 60,
                                ResourceRecords: [
                                    {
                                        Value: resourceRecord.Value
                                    }
                                ]
                            }
                        }
                    ))
                }
            },
            changeRecordResult = await awsClient.request('Route53', 'changeResourceRecordSets', changeRecordParams);

        // wait for DNS entry
        await waitForChange(() => checkChangeStatus(awsClient, changeRecordResult.ChangeInfo));
    }));

    serverless.cli.log(`Waiting for certificate verification...`);
    const certificateArn = await waitForChange(() => getCertificateArn(serverless, domains));
    serverless.cli.log(`Certificate for ${domains} successfully issued.`);
    return certificateArn;
};

module.exports = {
    addCloudFrontAlias,
    setupCertificate
};
