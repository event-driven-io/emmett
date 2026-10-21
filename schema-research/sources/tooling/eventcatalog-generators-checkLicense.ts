import chalk from 'chalk';
import { isFeatureEnabled, hasOfflineLicenseKey, isEventCatalogScaleEnabled } from '@eventcatalog/license';

type CheckLicenseOptions = {
  allowEventCatalogScaleLicense?: boolean;
};

const hasLicenseKey = (licenseKey?: string) => Boolean(licenseKey?.trim());

export default async (pkgName: string, licenseKey?: string, options: CheckLicenseOptions = {}) => {
  let licenseCheckFailed = false;

  if (hasOfflineLicenseKey()) {
    try {
      if (await isFeatureEnabled(pkgName)) {
        return Promise.resolve();
      }

      if (options.allowEventCatalogScaleLicense && (await isEventCatalogScaleEnabled())) {
        return Promise.resolve();
      }
    } catch (error) {
      licenseCheckFailed = true;
      console.log(error);
    }
  } else {
    const hasPluginLicenseKey = hasLicenseKey(licenseKey);
    const hasScaleLicenseKey = options.allowEventCatalogScaleLicense && hasLicenseKey(process.env.EVENTCATALOG_SCALE_LICENSE_KEY);

    if (!hasPluginLicenseKey && !hasScaleLicenseKey) {
      console.log(chalk.bgRed(`\nNo license key provided for ${pkgName}`));
      console.log(chalk.redBright('You can get a free 14 day trial license at https://eventcatalog.cloud/'));
      process.exit(1);
    }

    if (hasPluginLicenseKey) {
      try {
        if (await isFeatureEnabled(pkgName, licenseKey)) {
          return Promise.resolve();
        }
      } catch (error) {
        licenseCheckFailed = true;
        console.log(error);
      }
    }

    if (hasScaleLicenseKey) {
      try {
        if (await isEventCatalogScaleEnabled()) {
          return Promise.resolve();
        }
      } catch (error) {
        licenseCheckFailed = true;
        console.log(error);
      }
    }
  }

  if (licenseCheckFailed) {
    console.log(chalk.bgRed(`\nFailed to verify license key`));
    console.log(chalk.redBright('Please check your plugin license key or purchase a license at https://eventcatalog.cloud/'));
    process.exit(1);
  }

  console.log(chalk.bgRed(`\nInvalid license key`));
  console.log(chalk.redBright('Please check your plugin license key or purchase a license at https://eventcatalog.cloud/'));
  process.exit(1);
};
