const getCertificateArn = async (serverless, domain) => {
    const awsClient = serverless.getProvider('aws'),
        requestParams = {
            CertificateStatuses: ['ISSUED']
        },
        listCertificatesResponse = await awsClient.request('ACM', 'listCertificates', requestParams);
    
    // if multiple domains are provided, we have to find a cert that covers all of them
    if (Array.isArray(domain)) {
        const certificate = (
          await Promise.all(
            // filter out certs without one of the domains in their "main" DomainName
            // before requesting detailed certificate data
            listCertificatesResponse.CertificateSummaryList.filter(
              (certificate) => domain.includes(certificate.DomainName)
            ).map(
              async (certificate) =>
                await awsClient.request("ACM", "describeCertificate", {
                  CertificateArn: certificate.CertificateArn,
                })
            )
          )
        ).find((certificateDesc) =>
          domain.every((domain) =>
            certificateDesc.Certificate.SubjectAlternativeNames.includes(domain)
          )
        );

        return certificate ? certificate.Certificate.CertificateArn : null;
    } else {
        const certificate = listCertificatesResponse.CertificateSummaryList
                .find(certificate => certificate.DomainName === domain);

        return certificate ? certificate.CertificateArn : null;
    }
}

const requestCertificateWithDNS = async (serverless, domain) => {
    if (!Array.isArray(domain)) domain = [domain];
    const awsClient = serverless.getProvider('aws'),
        requestCertificateParams = {
            DomainName: domain[0],
            ValidationMethod: 'DNS',
            SubjectAlternativeNames: domain.length > 1 ? domain.slice(1) : null
        },
        requestCertificateResponse = await awsClient.request('ACM', 'requestCertificate', requestCertificateParams),
        describeCertificateParams = {
            CertificateArn: requestCertificateResponse.CertificateArn
        },
        describeCertificateResponse = await awsClient.request('ACM', 'describeCertificate', describeCertificateParams);

    return describeCertificateResponse.Certificate;
}

module.exports = {
    getCertificateArn,
    requestCertificateWithDNS
}
