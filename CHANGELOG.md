# fullstack-serverless Change Log

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/)
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

- Add `route53` config parameter to manage domains and certifiactes automatically using route53

## [0.8.0] - 2021-1-28
Thanks @pecirep, @miguel-a-calles-mba, @superandrew213

### Added
- Add `invalidationPaths` setting to allow defining custom invalidation paths for the cloudfront distribution
- Add `origins` setting to allow adding additional distribution origins in the form of CloudFormation resources
- Add `defaultCacheBehavior` setting to allow adding the default distribution cache behaviors in the form of CloudFormation resources
- Add `cacheBehaviors` setting to allow adding additional distribution cache behaviors in the form of CloudFormation resources
- Add `--no-client-deploy` CLI option to skip deploying client code to S3

### Fixed
- Typos
## [0.7.1] - 2020-3-18
Thanks @artoliukkonen

- Add `noConfirm` setting to allow changing the client upload behavior via config 


## [0.7.0] - 2019-9-15
Thanks @hakimio

- Add ability to invalidate the CloudFront distribution when deploying the client
- 
### Fixed
- Using shared API Gateway #11

## [0.6.1] - 2019-7-7
Thanks @haochang

- Pass the environment variables from the serverless template to the process generating the client

## [0.6.0] - 2019-4-28
- Enable compression of web assets using CloudFront. This changes the default behavior (no compression). To continue **not** using compression for your web assets set `compressWebContent: false`.

### Fixed
-  Typo in log output - Thanks @jmortlock

## [0.5.8] - 2019-4-3
- Add priceClass & minimumProtocolVersion. Thanks @harmon25

## [0.5.7] - 2019-2-6
- Add objectHeaders to the documentation. Thanks @superandrew213!

## [0.5.6] - 2018-7-14

### Fixed
- Fix issue parsing stage options from the command line

## [0.5.5] - 2018-7-1

Better support for generating client code on Windows

### Fixed
- Fix issue #2 with child_process.spawn(...) on windows. Thanks @jlaramie!

## [0.5.4] - 2018-7-1

### Fixed
- Fix issue #1 with DefaultRootObject not being set correctly. Thanks @jlaramie!

## [0.5.3] - 2018-5-26
- Documentation updates

## [0.5.2] - 2018-05-25

### Added
- Support default documents (index.html) in sub-directories

## [0.5.1] - 2018-05-23

### Added
- Allow configuration with no ApiGateway end points

## 0.5.0 - 2018-05-17

- Initial release

[Unreleased]: https://github.com/MadSkills-io/fullstack-serverless/compare/v0.8.0...HEAD
[0.8.0]: https://github.com/MadSkills-io/fullstack-serverless/compare/v0.7.1...v0.8.0
[0.7.1]: https://github.com/MadSkills-io/fullstack-serverless/compare/v0.7.0...v0.7.1
[0.7.0]: https://github.com/MadSkills-io/fullstack-serverless/compare/v0.6.1...v0.7.0
[0.6.1]: https://github.com/MadSkills-io/fullstack-serverless/compare/v0.6.0...v0.6.1
[0.6.0]: https://github.com/MadSkills-io/fullstack-serverless/compare/v0.5.8...v0.6.0
[0.5.8]: https://github.com/MadSkills-io/fullstack-serverless/compare/v0.5.7...v0.5.8
[0.5.7]: https://github.com/MadSkills-io/fullstack-serverless/compare/v0.5.6...v0.5.7
[0.5.6]: https://github.com/MadSkills-io/fullstack-serverless/compare/v0.5.5...v0.5.6
[0.5.5]: https://github.com/MadSkills-io/fullstack-serverless/compare/v0.5.4...v0.5.5
[0.5.4]: https://github.com/MadSkills-io/fullstack-serverless/compare/v0.5.3...v0.5.4
[0.5.3]: https://github.com/MadSkills-io/fullstack-serverless/compare/v0.5.2...v0.5.3
[0.5.2]: https://github.com/MadSkills-io/fullstack-serverless/compare/v0.5.1...v0.5.2
[0.5.1]: https://github.com/MadSkills-io/fullstack-serverless/compare/v0.5.0...v0.5.1