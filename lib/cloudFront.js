const getCloudFrontDistributionId = async (serverless) => {
    const awsClient = serverless.getProvider('aws'),
        requestParams = {
            StackName: awsClient.naming.getStackName()
        },
        listResourcesResponse = await awsClient.request('CloudFormation', 'listStackResources', requestParams),
        apiDistribution = listResourcesResponse.StackResourceSummaries
            .find(stack => stack.LogicalResourceId === 'ApiDistribution');

    return !apiDistribution ? null : apiDistribution.PhysicalResourceId;
};

const invalidateCloudfrontDistribution = async (serverless, invalidationPaths) => {
    const distributionId = await getCloudFrontDistributionId(serverless);

    if (!distributionId) {
        serverless.cli.log('CloudFront distribution id was not found. Skipping CloudFront invalidation.');
        return;
    }

    const awsClient = serverless.getProvider('aws'),
        invalidationParams = {
            DistributionId: distributionId,
            InvalidationBatch: {
                CallerReference: Date.now().toString(),
                Paths: {
                    Quantity: invalidationPaths.length,
                    Items: invalidationPaths
                }
            }
        },
        invalidationResponse = await awsClient.request('CloudFront', 'createInvalidation', invalidationParams),
        invalidationId = invalidationResponse.Invalidation.Id;

    serverless.cli.log('CloudFront invalidation started...');

    const checkInvalidationStatus = async () => {
        const getInvalidationParams = {
                DistributionId: distributionId,
                Id: invalidationId
            },
            getInvalidationResponse = await awsClient.request('CloudFront', 'getInvalidation', getInvalidationParams);

        return getInvalidationResponse.Invalidation.Status === 'Completed';
    };
    const waitForInvalidation = async (resolve) => {
        const isInvalidationComplete = await checkInvalidationStatus();

        if (isInvalidationComplete) {
            resolve();
        } else {
            setTimeout(waitForInvalidation, 1000, resolve);
        }
    };

    await new Promise(resolve => waitForInvalidation(resolve));

    serverless.cli.log('CloudFront invalidation completed.');
};

const getCloudFrontDomainName = async (serverless) => {
    const awsClient = serverless.getProvider('aws'),
        requestParams = {
            Id: await getCloudFrontDistributionId(serverless)
        },
        getDistributionResponse = await awsClient.request('CloudFront', 'getDistribution', requestParams);

    return getDistributionResponse.Distribution.DomainName;
};

module.exports = {
    invalidateCloudfrontDistribution,
    getCloudFrontDomainName
};
