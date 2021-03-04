const path = require('path');
const _ = require('lodash');
const chalk = require('chalk');
const yaml = require('js-yaml');
const fs = require('fs');
const {spawn} = require('child_process');

const BbPromise = require('bluebird');
const Confirm = require('prompt-confirm');

const bucketUtils = require('./lib/bucketUtils');
const uploadDirectory = require('./lib/upload');
const validateClient = require('./lib/validate');
const {invalidateCloudfrontDistribution} = require('./lib/cloudFront');
const {addCloudFrontAlias, setupCertificate} = require('./lib/route53');
const {getCertificateArn} = require('./lib/acm');

class ServerlessFullstackPlugin {
    constructor(serverless, cliOptions) {

        this.error = serverless.classes.Error;
        this.serverless = serverless;
        this.options = serverless.service.custom.fullstack;
        this.cliOptions = cliOptions || {};
        this.aws = this.serverless.getProvider('aws');

        this.hooks = {
            'package:createDeploymentArtifacts': this.createDeploymentArtifacts.bind(this),
            'aws:info:displayStackOutputs': this.printSummary.bind(this),
            'client:client': () => this.serverless.cli.log(this.commands.client.usage),
            'before:client:deploy:deploy': this.generateClient.bind(this),
            'client:deploy:deploy': this.processDeployment.bind(this),
            'client:remove:remove': this.removeDeployedResources.bind(this),
            'after:aws:deploy:deploy:updateStack': () => this.serverless.pluginManager.run(['client', 'deploy']),
            'before:remove:remove': () => this.serverless.pluginManager.run(['client', 'remove']),
            'before:aws:package:finalize:mergeCustomProviderResources': this.checkForApiGataway.bind(this)
        };

        this.commands = {
            client: {
                usage: 'Generate and deploy clients',
                lifecycleEvents: ['client', 'deploy'],
                commands: {
                    deploy: {
                        usage: 'Deploy serverless client code',
                        lifecycleEvents: ['deploy']
                    },
                    remove: {
                        usage: 'Removes deployed files and bucket',
                        lifecycleEvents: ['remove']
                    }
                }
            }
        };
    }

    validateConfig() {
        try {
            validateClient(this.serverless, this.options);
        } catch (e) {
            return BbPromise.reject(`Fullstack serverless configuration errors:\n- ${e.join('\n- ')}`);
        }
        return BbPromise.resolve();
    }

    removeDeployedResources() {
        let bucketName;

        return this.validateConfig()
            .then(() => {
                bucketName = this.getBucketName(this.options.bucketName);
                return (this.cliOptions.confirm === false || this.options.noConfirm === true) ? true : new Confirm(`Are you sure you want to delete bucket '${bucketName}'?`).run();
            })
            .then(goOn => {
                if (goOn) {
                    this.serverless.cli.log(`Looking for bucket '${bucketName}'...`);
                    return bucketUtils.bucketExists(this.aws, bucketName).then(exists => {
                        if (exists) {
                            this.serverless.cli.log(`Deleting all objects from bucket...`);
                            return bucketUtils
                                .emptyBucket(this.aws, bucketName)
                                .then(() => {
                                    this.serverless.cli.log(
                                        `Success! Your client files have been removed`
                                    );
                                });
                        } else {
                            this.serverless.cli.log(`Bucket does not exist`);
                        }
                    });
                }
                this.serverless.cli.log('Bucket not removed');
                return BbPromise.resolve();
            })
            .catch(error => {
                return BbPromise.reject(new this.error(error));
            });
    }

    setClientEnv() {
        this.serverless.cli.log(`Setting the environment variables...`);
        const serverlessEnv = this.serverless.service.provider.environment;

        if (!serverlessEnv) {
          return this.serverless.cli.log(
            `No environment variables detected. Skipping step...`
          );
        }

        return Object.assign({}, process.env, serverlessEnv);
    }

    generateClient() {
        const clientCommand = this.options.clientCommand;
        const clientSrcPath = this.options.clientSrcPath || '.';
        if (clientCommand && this.cliOptions['generate-client'] !== false) {
            const args = clientCommand.split(' ');
            const command = args.shift();
            return new BbPromise(this.performClientGeneration.bind(this, command, args, clientSrcPath));

        } else {
            this.serverless.cli.log(`Skipping client generation...`);
        }

        return BbPromise.resolve();
    }

    performClientGeneration(command, args, clientSrcPath, resolve, reject) {
        this.serverless.cli.log(`Generating client...`);
        const clientEnv = this.setClientEnv();
        const proc = spawn(command, args, {cwd: clientSrcPath, env: clientEnv, shell: true});

        proc.stdout.on('data', (data) => {
            const printableData = data ? `${data}`.trim() : '';
            this.serverless.cli.consoleLog(`   ${chalk.dim(printableData)}`);
        });

        proc.stderr.on('data', (data) => {
            const printableData = data ? `${data}`.trim() : '';
            this.serverless.cli.consoleLog(`   ${chalk.red(printableData)}`);
        });

        proc.on('close', (code) => {
            if (code === 0) {
                this.serverless.cli.log(`Client generation process succeeded...`);
                resolve();
            } else {
                reject(new this.error(`Client generation failed with code ${code}`));
            }
        });
    }

    processDeployment() {

        if(this.cliOptions['client-deploy'] !== false) {
            let region,
                distributionFolder,
                clientPath,
                bucketName,
                headerSpec,
                indexDoc,
                errorDoc,
                invalidationPaths;

            return this.validateConfig()
                .then(() => {
                    // region is set based on the following order of precedence:
                    // If specified, the CLI option is used
                    // If region is not specified via the CLI, we use the region option specified
                    //   under custom/client in serverless.yml
                    // Otherwise, use the Serverless region specified under provider in serverless.yml
                    region =
                        this.cliOptions.region ||
                        this.options.region ||
                        _.get(this.serverless, 'service.provider.region');

                    distributionFolder = this.options.distributionFolder || path.join('client/dist');
                    clientPath = path.join(this.serverless.config.servicePath, distributionFolder);
                    bucketName = this.getBucketName(this.options.bucketName);
                    headerSpec = this.options.objectHeaders;
                    indexDoc = this.options.indexDocument || "index.html";
                    errorDoc = this.options.errorDocument || "error.html";
                    invalidationPaths = this.options.invalidationPaths || ['/*'];

                    if (!Array.isArray(invalidationPaths)) {
                        invalidationPaths = [invalidationPaths];
                    }
                    
                    //paths must start with '/'
                    invalidationPaths = invalidationPaths.map(path => path[0] === '/' ? path : '/' + path);

                    const deployDescribe = ['This deployment will:'];

                    if (this.cliOptions['delete-contents'] !== false) {
                        deployDescribe.push(`- Remove all existing files from bucket '${bucketName}'`);
                    }
                    deployDescribe.push(
                        `- Upload all files from '${distributionFolder}' to bucket '${bucketName}'`
                    );

                    deployDescribe.forEach(m => this.serverless.cli.log(m));
                    return (this.cliOptions.confirm === false || this.options.noConfirm === true) ? true : new Confirm(`Do you want to proceed?`).run();
                })
                .then(goOn => {
                    if (goOn) {
                        this.serverless.cli.log(`Looking for bucket '${bucketName}'...`);
                        return bucketUtils
                            .bucketExists(this.aws, bucketName)
                            .then(exists => {
                                if (exists) {
                                    this.serverless.cli.log(`Bucket found...`);
                                    if (this.cliOptions['delete-contents'] === false) {
                                        this.serverless.cli.log(`Keeping current bucket contents...`);
                                        return BbPromise.resolve();
                                    }

                                    this.serverless.cli.log(`Deleting all objects from bucket...`);
                                    return bucketUtils.emptyBucket(this.aws, bucketName);
                                } else {
                                    this.serverless.cli.log(`Bucket does not exist. Run ${chalk.black('serverless deploy')}`);
                                    return BbPromise.reject('Bucket does not exist!');
                                }
                            })
                            .then(() => {
                                this.serverless.cli.log(`Uploading client files to bucket...`);
                                return uploadDirectory(this.aws, bucketName, clientPath, headerSpec);
                            })
                            .then(() => {
                                this.serverless.cli.log(
                                    `Success! Client deployed.`
                                );
                            });
                    }
                    this.serverless.cli.log('Client deployment cancelled');
                    return BbPromise.resolve();
                })
                .then(() => {
                    if (this.cliOptions['invalidate-distribution'] === false) {
                        this.serverless.cli.log(`Skipping cloudfront invalidation...`);
                    } else {
                        return invalidateCloudfrontDistribution(this.serverless, invalidationPaths);
                    }
                })
                .catch(error => {
                    return BbPromise.reject(new this.error(error));
                });
        } else {
            this.serverless.cli.log(`Skipping client deployment...`);
        }
    }

    createDeploymentArtifacts() {
        const baseResources = this.serverless.service.provider.compiledCloudFormationTemplate;

        const filename = path.resolve(__dirname, 'lib/resources/resources.yml');
        const content = fs.readFileSync(filename, 'utf-8');
        const resources = yaml.safeLoad(content, {
            filename: filename
        });

        this.prepareResources(resources);
        return this.setupDomainAndCert(resources).then(() => {
            return _.merge(baseResources, resources);
        });
    }

    checkForApiGataway() {
        const baseResources = this.serverless.service.provider.compiledCloudFormationTemplate;
        const apiGatewayConfig = baseResources.Resources.ApiGatewayRestApi;

        if (!apiGatewayConfig && !this.setApiGatewayIdFromConfig(baseResources)) {
            this.removeApiGatewayOrigin(baseResources);
        }

        return baseResources;
    }

    removeApiGatewayOrigin(baseResources) {
        this.serverless.cli.log(`ApiGatewayRestApi not found, removing origin from CloudFront...`);
        const distributionConfig = baseResources.Resources.ApiDistribution.Properties.DistributionConfig;
        distributionConfig.Origins = _.filter(distributionConfig.Origins, (origin => {
            return origin.Id !== 'ApiGateway';
        }));
        distributionConfig.CacheBehaviors = _.filter(distributionConfig.CacheBehaviors, (cacheBehavior => {
            return cacheBehavior.TargetOriginId !== 'ApiGateway';
        }));
    }

    setApiGatewayIdFromConfig(baseResources) {
        const restApiId = this.getRestApiId();

        if (!restApiId) {
            return false;
        }

        const distributionConfig = baseResources.Resources.ApiDistribution.Properties.DistributionConfig;
        const apiOrigin = distributionConfig.Origins.find(origin => origin.Id === 'ApiGateway');

        apiOrigin.DomainName = {
            'Fn::Join': ['', [restApiId, '.execute-api.', {
                Ref: 'AWS::Region'
            }, '.amazonaws.com']]
        };

        return true;
    }

    getRestApiId() {
        const apiGatewaySection = this.serverless.service.provider.apiGateway;

        if (apiGatewaySection && apiGatewaySection.restApiId) {
            return apiGatewaySection.restApiId;
        }

        return this.getConfig('apiGatewayRestApiId', null);
    }

    printSummary() {
        const awsInfo = _.find(this.serverless.pluginManager.getPlugins(), (plugin) => {
            return plugin.constructor.name === 'AwsInfo';
        });

        if (!awsInfo || !awsInfo.gatheredData) {
            return;
        }

        const outputs = awsInfo.gatheredData.outputs;
        const apiDistributionDomain = _.find(outputs, (output) => {
            return output.OutputKey === 'ApiDistribution';
        });

        if (!apiDistributionDomain || !apiDistributionDomain.OutputValue) {
            return;
        }

        const cnameDomain = this.getConfig('domain', '-');

        this.serverless.cli.consoleLog(chalk.yellow('CloudFront domain name'));
        this.serverless.cli.consoleLog(`  ${apiDistributionDomain.OutputValue} (CNAME: ${cnameDomain})`);
    }

    async setupDomainAndCert(resources) {
        const certificate = this.getConfig("certificate", null);
        const distributionCertificate = resources.Resources.ApiDistribution.Properties.DistributionConfig.ViewerCertificate;
    
        if (this.options.domain) {
            if (this.getConfig("route53", false)) {
                await addCloudFrontAlias(
                    this.serverless,
                    this.options.domain
                );
                // only create and override if not specified
                if (certificate === null) {
                    distributionCertificate.AcmCertificateArn = await setupCertificate(
                        this.serverless,
                        this.options.domain
                    );
                }
            } else {
                // only override if not specified
                if (certificate === null) {
                    distributionCertificate.AcmCertificateArn = await getCertificateArn(
                        this.serverless,
                        this.options.domain
                    );
                }
            }
        }
    }

    prepareResources(resources) {
        const distributionConfig = resources.Resources.ApiDistribution.Properties.DistributionConfig;

        this.prepareLogging(distributionConfig);
        this.prepareDomain(distributionConfig);
        this.preparePriceClass(distributionConfig);
        this.prepareOrigins(distributionConfig);
        this.preparePathPattern(distributionConfig);
        this.prepareComment(distributionConfig);
        this.prepareCertificate(distributionConfig);
        this.prepareWaf(distributionConfig);
        this.prepareSinglePageApp(resources.Resources);
        this.prepareS3(resources.Resources);
        this.prepareMinimumProtocolVersion(distributionConfig);
        this.prepareDefaultCacheBehavior(distributionConfig);

    }

    prepareLogging(distributionConfig) {
        const loggingBucket = this.getConfig('logging.bucket', null);

        if (loggingBucket !== null) {
            this.serverless.cli.log(`Setting up logging bucket...`);
            distributionConfig.Logging.Bucket = loggingBucket;
            distributionConfig.Logging.Prefix = this.getConfig('logging.prefix', '');

        } else {
            this.serverless.cli.log(`Removing logging bucket...`);
            delete distributionConfig.Logging;
        }
    }

    prepareDomain(distributionConfig) {
        const domain = this.getConfig('domain', null);

        if (domain !== null) {
            this.serverless.cli.log(`Adding domain alias ${domain}...`);
            distributionConfig.Aliases = Array.isArray(domain) ? domain : [domain];
        } else {
            delete distributionConfig.Aliases;
        }
    }

    preparePriceClass(distributionConfig) {
        const priceClass = this.getConfig('priceClass', 'PriceClass_All');
        this.serverless.cli.log(`Setting price class ${priceClass}...`);
        distributionConfig.PriceClass = priceClass;
    }

    prepareOrigins(distributionConfig) {
        this.serverless.cli.log(`Setting ApiGateway stage to '${this.getStage()}'...`);
        for (var origin of distributionConfig.Origins) {
            if (origin.Id === 'ApiGateway') {
                origin.OriginPath = `/${this.getStage()}`;
            }
        }
        
        const customOrigins = this.getConfig('origins', null);
        if (customOrigins) {
            distributionConfig.Origins.push(
                ...customOrigins
            );
        }
    }

    preparePathPattern(distributionConfig) {
        const apiPath = this.getConfig('apiPath', 'api');
        this.serverless.cli.log(`Setting API path prefix to '${apiPath}'...`);
        for (let cacheBehavior of distributionConfig.CacheBehaviors) {
            if (cacheBehavior.TargetOriginId === 'ApiGateway') {
                cacheBehavior.PathPattern = `${apiPath}/*`;
            }
        }
        
        const customCacheBehaviors = this.getConfig('cacheBehaviors', null);
        if (customCacheBehaviors) {
            distributionConfig.CacheBehaviors.push(
                ...customCacheBehaviors
            );
        }
    }

    prepareComment(distributionConfig) {
        const name = this.serverless.getProvider('aws').naming.getApiGatewayName();
        distributionConfig.Comment = `Serverless Managed ${name}`;
    }

    prepareCertificate(distributionConfig) {
        const certificate = this.getConfig('certificate', null);

        if (certificate !== null) {
            this.serverless.cli.log(`Configuring SSL certificate...`);
            distributionConfig.ViewerCertificate.AcmCertificateArn = certificate;
        } else if (!this.options.domain) {  // if domain is set certificate will either be created or found
            delete distributionConfig.ViewerCertificate;
        }
    }

   prepareMinimumProtocolVersion(distributionConfig) {
    const minimumProtocolVersion = this.getConfig('minimumProtocolVersion', undefined);

    if (minimumProtocolVersion) {
      distributionConfig.ViewerCertificate.MinimumProtocolVersion = minimumProtocolVersion;
    }
  }

    prepareWaf(distributionConfig) {
        const waf = this.getConfig('waf', null);

        if (waf !== null) {
            this.serverless.cli.log(`Enabling web application firewall...`);
            distributionConfig.WebACLId = waf;
        } else {
            delete distributionConfig.WebACLId;
        }
    }

    prepareSinglePageApp(resources) {
        const distributionConfig = resources.ApiDistribution.Properties.DistributionConfig;
        const isSinglePageApp = this.getConfig('singlePageApp', false);
        if (isSinglePageApp) {
            this.serverless.cli.log(`Configuring distribution for single page web app...`);
            const indexDocument = this.getConfig('indexDocument', 'index.html')
            for (let errorResponse of distributionConfig.CustomErrorResponses) {
                if (errorResponse.ErrorCode === '403') {
                    errorResponse.ResponsePagePath = `/${indexDocument}`;
                }
            }

            // Cloudfront default root object
            distributionConfig.DefaultRootObject = indexDocument;

            // Remove public read access to bucket, as all access is through the API for single page apps
            const statements = resources.WebAppS3BucketPolicy.Properties.PolicyDocument.Statement;
            resources.WebAppS3BucketPolicy.Properties.PolicyDocument.Statement = _.filter(statements, (statement) => {
                return statement.Sid !== 'AllowPublicRead';
            });

            for (let origin of distributionConfig.Origins) {
                if (origin.Id === 'WebApp') {
                    delete origin.CustomOriginConfig;
                }
            }
        } else {
            delete distributionConfig.CustomErrorResponses;
            delete resources.S3OriginAccessIdentity;

            // Remove API access to S3 bucket since all content will be served through http
            const statements = resources.WebAppS3BucketPolicy.Properties.PolicyDocument.Statement;
            resources.WebAppS3BucketPolicy.Properties.PolicyDocument.Statement = _.filter(statements, (statement) => {
                return statement.Sid !== 'OAIGetObject';
            });


            for (let origin of distributionConfig.Origins) {
                if (origin.Id === 'WebApp') {
                    delete origin.S3OriginConfig;
                    origin.DomainName = {
                        // Select hostname
                        "Fn::Select": ["1",
                            {
                                // Split URL into protocol and hostname
                                "Fn::Split": ["://",
                                    {
                                        // Get the bucket URL
                                        'Fn::GetAtt': ["WebAppS3Bucket", "WebsiteURL"]
                                    }
                                ]
                            }
                        ]
                    }
                }
            }
        }
    }

    prepareS3(resources) {
        const bucketName = this.getConfig('bucketName', null);

        if (bucketName !== null) {
            const stageBucketName = this.getBucketName(bucketName);
            this.serverless.cli.log(`Setting up '${stageBucketName}' bucket...`);
            resources.WebAppS3Bucket.Properties.BucketName = stageBucketName;
            resources.WebAppS3BucketPolicy.Properties.Bucket = stageBucketName;
        } else {
            this.serverless.cli.log(`Setting up '${resources.WebAppS3Bucket.Properties.BucketName}' bucket...`);
        }

        const indexDocument = this.getConfig('indexDocument', 'index.html');
        const errorDocument = this.getConfig('errorDocument', 'error.html');

        this.serverless.cli.log(`Setting indexDocument to '${indexDocument}'...`);
        this.serverless.cli.log(`Setting errorDocument to '${errorDocument}'...`);

        resources.WebAppS3Bucket.Properties.WebsiteConfiguration.IndexDocument = indexDocument;
        resources.WebAppS3Bucket.Properties.WebsiteConfiguration.ErrorDocument = errorDocument;
    }

    prepareDefaultCacheBehavior(distributionConfig) {
        const defaultCacheBehavior = this.getConfig('defaultCacheBehavior', {})
        const compressWebContent = this.getConfig('compressWebContent', true);

        distributionConfig.DefaultCacheBehavior = Object.assign({},
            distributionConfig.DefaultCacheBehavior,
            defaultCacheBehavior,
            { Compress: compressWebContent }
        );
    }

    getBucketName(bucketName) {
        const stageBucketName = `${this.serverless.service.service}-${this.getStage()}-${bucketName}`;
        return stageBucketName;
    }

    getConfig(field, defaultValue) {
        return _.get(this.serverless, `service.custom.fullstack.${field}`, defaultValue)
    }

    getStage() {
        // find the correct stage name
        var stage = this.serverless.service.provider.stage;
        if (this.cliOptions && this.cliOptions.stage) {
            stage = this.cliOptions.stage;
        }
        return stage;
    }
}

module.exports = ServerlessFullstackPlugin;
