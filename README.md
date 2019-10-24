# fullstack-serverless

[![serverless](http://public.serverless.com/badges/v3.svg)](http://www.serverless.com)
[![npm version](https://badge.fury.io/js/fullstack-serverless.svg)](https://badge.fury.io/js/fullstack-serverless)
[![MIT licensed](https://img.shields.io/badge/license-MIT-blue.svg)](https://raw.githubusercontent.com/MadSkills-io/fullstack-serverless/master/LICENSE)
[![npm downloads](https://img.shields.io/npm/dt/fullstack-serverless.svg?style=flat)](https://www.npmjs.com/package/fullstack-serverless)

A [serverless](http://www.serverless.com) plugin that automatically creates an AWS CloudFront distribution that serves static web content from S3 and optionally routes API traffic
to API Gateway.

Home page - https://www.madskills.io/fullstack-serverless/

**:zap: Pros**

- Allows you to set-up custom domain for a S3 hosted site and API Gateway
- Free SSL using AWS CertificateManager
- No CORS needed
- Enables CDN caching of resources - so you don't waste Lambda invocations or API Gateway traffic
  for serving static files (just [set Cache-Control headers](https://serverless.com/framework/docs/providers/aws/events/apigateway/#custom-response-headers) in API responses)
- Much more CloudWatch statistics of API usage (like bandwidth metrics)
- Real world [access log](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/AccessLogs.html) - out of the box, API Gateway currently does not provide any kind of real "apache-like" access logs for your invocations
- [Web Application Firewall](https://aws.amazon.com/waf/) support - enable AWS WAF to protect your API from security threats

## Before you begin
* Install the serverless framework
```bash
npm install -g serverless
```
* [Setup an AWS account and configure access](https://serverless.com/framework/docs/providers/aws/guide/credentials/)

## Getting started
**First**, Install and configure

#### Installation

```bash
npm install --save-dev fullstack-serverless
```

#### Configuration

* All fullstack-serverless configuration parameters are optional - e.g. don't provide ACM Certificate ARN
  to use default CloudFront certificate (which works only for default cloudfront.net domain).
* This plugin **does not** set-up automatically Route53 for newly created CloudFront distribution.
  After creating CloudFront distribution, manually add Route53 ALIAS record pointing to your
  CloudFront domain name.
* First deployment may be quite long (e.g. 10 min) as Serverless is waiting for
  CloudFormation to deploy CloudFront distribution.


```yaml
# add to your serverless.yml

plugins:
  - fullstack-serverless

custom:
  fullstack:
    domain: my-custom-domain.com
    certificate: arn:aws:acm:us-east-1:...     # The ARN for the SSL cert to use form AWS CertificateManager
    bucketName: webapp-deploy                  # Unique name for the S3 bucket to host the client assets
    distributionFolder: client/dist            # Path to the client assets to be uploaded to S3
    indexDocument: index.html                  # The index document to use
    errorDocument: error.html                  # The error document to use
    singlePageApp: false                       # If true 403 errors will be rerouted (missing assets) to your root index document to support single page apps like React and Angular where the js framework handles routing
    compressWebContent: true                   # Use compression when serving web content
    apiPath: api                               # The path prefix for your API Gateway lambdas. The path for the lambda http event trigger needs to start with this too eg. api/myMethod
    apiGatewayRestApiId: a12bc34df5            # If "Api Gateway Rest Api" is not part of the same serverless template, you can set your API id here
    clientCommand: gulp dist                   # Command to generate the client assets. Defaults to doing nothing
    clientSrcPath: client                      # The path to where you want to run the clientCommand
    waf: 00000000-0000-0000-0000-000000000000  # ID of the Web Application Firewall. Defaults to not used
    logging:
      bucket: my-bucket.s3.amazonaws.com
      prefix: my-prefix
    minimumProtocolVersion: TLSv1.2_2018
    priceClass: PriceClass_100
```


**Second**, Create a website folder in the root directory of your Serverless project. This is where your distribution-ready website should live. By default the plugin expects the files to live in a folder called `client/dist`. But this is configurable with the `distributionFolder` option (see the [Configuration Parameters](#configuration-parameters) below).

The plugin uploads the entire `distributionFolder` to S3 and configures the bucket to host the website and make it publicly available, also setting other options based the [Configuration Parameters](#configuration-parameters) specified in `serverless.yml`.

To test the plugin initially you can copy/run the following commands in the root directory of your Serverless project to get a quick sample website for deployment:

```bash
mkdir -p client/dist
touch client/dist/index.html
touch client/dist/error.html
echo "Go Serverless" >> client/dist/index.html
echo "error page" >> client/dist/error.html
```

**Third**, run the plugin (this can take several minutes the first time), and visit your new website!

```bash
serverless deploy [--no-delete-contents] [--no-generate-client]
```

The plugin should output the location of your newly deployed static site to the console.

**Note:** *See [Command-line Parameters](#command-line-parameters) for details on command above*

**WARNING:** The plugin will overwrite any data you have in the bucket name you set above if it already exists.

To just generate and deploy your client code:

```bash
serverless client deploy [--no-delete-contents] [--no-generate-client]
```

If later on you want to take down the website you can use:

```bash
serverless client remove
```

### Configuration Parameters

**bucketName**

_required_

```yaml
custom:
  fullstack:
    ...
    bucketName: [unique-s3-bucketname]
    ...
```

Use this parameter to specify a unique name for the S3 bucket that your files will be uploaded to.

---

**distributionFolder**

_optional_, default: `client/dist`

```yaml
custom:
  fullstack:
    ...
    distributionFolder: [path/to/files]
    ...
```

Use this parameter to specify the path that contains your website files to be uploaded. This path is relative to the path that your `serverless.yaml` configuration files resides in.

---

**apiPath**

_optional_, default: `api`

```yaml
custom:
  fullstack:
    ...
    apiPath: api
    ...
```

Use this parameter to specify the path prefix your API Gateway methods will be available through on your CloudFront distribution (custom domain)

* If `http` events are defined, `apiPath` must be included in the path for the lambdas you want exposed through CloudFront (your custom domain). Not all your methods need to be exposed through CloudFront. For some things, esp. those that are not public facing (eg. third party web hooks) you may want to use the ApiGateway URL and not expose them through CloudFront to control access and cost.

```yaml
functions:
  message:
    handler: message.handler
    timeout: 30
    events:
      - http:
        path: ${self:custom.fullstack.apiPath}/message
        method: post
        integration: lambda
```

---

**apiGatewayRestApiId**

_optional_, default: `not set`

```yaml
custom:
  fullstack:
    ...
    apiGatewayRestApiId: a12bc34df5
    ...
```

This is only needed if "Api Gateway Rest Api" is not part of the same serverless template and the API id is not defined in [provider -> apiGateway](https://serverless.com/framework/docs/providers/aws/events/apigateway/#share-api-gateway-and-api-resources) section.
The id can be found in API Gateway url. For example, if your Rest API url is `https://a12bc34df5.execute-api.eu-central-1.amazonaws.com`, API id will be `a12bc34df5`.

---

**certificate**

_optional_, default: `not set`

```yaml
custom:
  fullstack:
    ...
    certificate: arn:aws:acm:us-east-1:...
    ...
```

Use this parameter to specify ARN for the SSL cert to use form AWS CertificateManager

---

**indexDocument**

_optional_, default: `index.html`

```yaml
custom:
  fullstack:
    ...
    indexDocument: [file-name.ext]
    ...
```

The name of your index document inside your `distributionFolder`. This is the file that will be served to a client visiting the base URL for your website.

---

**domain**

_optional_, default: `not set`

```yaml
custom:
  fullstack:
    ...
    domain: my-custom-domain.com
    ...
```

`domain` can be a list, if you want to add more domains:
```yaml
custom:
  fullstack:
    ...
    domain:
    - my-custom-domain.com
    - secondary-custom-domain.com
    ...
```

The custom domain for your fullstack serverless app.

---

**errorDocument**

_optional_, default: `error.html`

```yaml
custom:
  fullstack:
    ...
    errorDocument: [file-name.ext]
    ...
```

The name of your error document inside your `distributionFolder`. This is the file that will be served to a client if their initial request returns an error (e.g. 404). For an SPA, you may want to set this to the same document specified in `indexDocument` so that all requests are redirected to your index document and routing can be handled on the client side by your SPA.

---

**objectHeaders**

_optional_, no default

```yaml
custom:
  fullstack:
    ...
    objectHeaders:
      ALL_OBJECTS:
        - name: header-name
          value: header-value
        ...
      specific-directory/:
        - name: header-name
          value: header-value
        ...
      specific-file.ext:
        - name: header-name
          value: header-value
        ...
      ... # more file- or folder-specific rules
    ...
```

Use the `objectHeaders` option to set HTTP response headers be sent to clients requesting uploaded files from your website.

Headers may be specified globally for all files in the bucket by adding a `name`, `value` pair to the `ALL_OBJECTS` property of the `objectHeaders` option. They may also be specified for specific folders or files within your site by specifying properties with names like `specific-directory/` (trailing slash required to indicate folder) or `specific-file.ext`, where the folder and/or file paths are relative to `distributionFolder`.

Headers with more specificity will take precedence over more general ones. For instance, if 'Cache-Control' was set to 'max-age=100' in `ALL_OBJECTS` and to 'max-age=500' in `my/folder/`, the files in `my/folder/` would get a header of 'Cache-Control: max-age=500'.

---

**singlePageApp**

_optional_, default: `false`

```yaml
custom:
  fullstack:
    ...
    singlePageApp: true
    ...
```

If true 403 errors will be rerouted (missing assets) to your root index document to support single page apps like React and Angular where the js framework handles routing

---

**compressWebContent**

_optional_, default: `true`

```yaml
custom:
  fullstack:
    ...
    compressWebContent: true
    ...
```

---

**defaultCacheBehavior**

_optional_, default: `not set`

```yaml
custom:
  fullstack:
    ...
    defaultCacheBehavior:
      MinTTL: 3600
    ...
```

---

**cacheBehaviors**

_optional_, default: `not set`

```yaml
custom:
  fullstack:
    ...
    cacheBehaviors:
       - MinTTL: 3600
         DefaultTTL: 3600
    ...
```

Instruct CloudFront to use compression when serving web content, see [Serving Compressed Files](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/ServingCompressedFiles.html) in the Amazon CloudFront Developer Guide.

---

**clientCommand**

_optional_, default: `not set`

```yaml
custom:
  fullstack:
    ...
    clientCommand: [command to generate your client (e.g. gulp dist)]
    ...
```

Command to generate the client assets. Defaults to doing nothing

---

**clientSrcPath**

_optional_, default: `not set`

```yaml
custom:
  fullstack:
    ...
    clientSrcPath: [path/to/your/client]
    ...
```

The path to where you want to run the `clientCommand`

---

**waf**

_optional_, default: `not set`

```yaml
custom:
  fullstack:
    ...
    waf: [web application firewall ARN]
    ...
```

[Web Application Firewall](https://aws.amazon.com/waf/) support - enable AWS WAF to protect your API from security threats

---

**logging**

_optional_, default: `not set`

```yaml
custom:
  fullstack:
    ...
    logging:
      bucket: my-bucket.s3.amazonaws.com
      prefix: my-prefix
    ...
```

Real world [access log](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/AccessLogs.html) - out of the box, API Gateway currently does not provide any kind of real "apache-like" access logs for your invocations

---

**priceClass**

_optional_, default: `PriceClass_All`

```yaml
custom:
  fullstack:
    ...
    priceClass: PriceClass_100
    ...
```

CloudFront [PriceClass](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/PriceClass.html) - can be PriceClass_All (default), PriceClass_100 or PriceClass_200

---

**minimumProtocolVersion**

_optional_, default: `TLSv1`

```yaml
custom:
  fullstack:
    ...
    minimumProtocolVersion: TLSv1.2_2018
    ...
```

Set minimum SSL/TLS [protocol version](https://docs.aws.amazon.com/cloudfront/latest/APIReference/API_ViewerCertificate.html#cloudfront-Type-ViewerCertificate-MinimumProtocolVersion) - `TLSv1_2016`, `TLSv1.1_2016`, `TLSv1.2_2018` or `SSLv3`

- The minimum SSL/TLS protocol that CloudFront uses to communicate with viewers
- The cipher that CloudFront uses to encrypt the content that it returns to viewers

---

### Command-line Parameters


**--no-delete-contents**

_optional_, default `false` (deletes contents by default)

```bash
serverless client deploy --no-delete-contents
```

Use this parameter if you do not want to delete the contents of your bucket before deployment. Files uploaded during deployment will still replace any corresponding files already in your bucket.

---

**--no-generate-client**

_optional_, default `false` (generates client code by default if `clientCommand` and `clientSrcPath` are configured)

```bash
serverless client deploy --no-generate-client
```

Use this parameter if you do not want to generate the client code before deploying. Files uploaded during deployment will still replace any corresponding files already in your bucket.

---

**--no-confirm**

_optional_, default `false` (disables confirmation prompt)

```bash
serverless client deploy --no-confirm
```

Use this parameter if you do not want a confirmation prompt to interrupt automated builds.

---

**--no-invalidate-distribution**

_optional_, default `false` (disables creating an invalidation for the CloudFront distribution)

```bash
serverless client deploy --no-invalidate-distribution
```

Use this parameter if you do not want to invalidate the CloudFront distribution. Invalidations are  for the path `/*`.

---

## Maintainers
- Andy Hahn - [andrewphahn](https://github.com/andrewphahn) from [_MadSkills.io_](http://madskills.io)

## Contributors
- [jlaramie](https://github.com/jlaramie)
- [superandrew213](https://github.com/superandrew213)
- [harmon25](https://github.com/harmon25)
- [jmortlock](https://github.com/jmortlock)
- [haochang](https://github.com/haochang)
- [hakimio](https://github.com/hakimio)

## Credits
Forked from the [**serverless-api-cloudfront**](https://github.com/Droplr/serverless-api-cloudfront/)
Borrowed heavily from the [**serverless-finch**](https://github.com/fernando-mc/serverless-finch/)
Initial CloudFormation template from [**Full Stack Serverless Web Apps with AWS**](https://medium.com/99xtechnology/full-stack-serverless-web-apps-with-aws-189d87da024a/)
Inspiration from [**serverless-stack.com**](https://serverless-stack.com/)
