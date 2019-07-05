import { Redis } from "ioredis";
import { isUndefined } from "lodash";
import { Db } from "mongodb";
import { URL } from "url";

import { discover } from "coral-server/app/middleware/passport/strategies/oidc/discover";
import { Config } from "coral-server/config";
import { TenantInstalledAlreadyError } from "coral-server/errors";
import { GQLSettingsInput } from "coral-server/graph/tenant/schema/__generated__/types";
import logger from "coral-server/logger";
import {
  createTenant,
  CreateTenantInput,
  regenerateTenantSSOKey,
  Tenant,
  updateTenant,
} from "coral-server/models/tenant";

import TenantCache from "./cache";

export type UpdateTenant = GQLSettingsInput;

export async function update(
  mongo: Db,
  redis: Redis,
  cache: TenantCache,
  config: Config,
  tenant: Tenant,
  input: UpdateTenant
): Promise<Tenant | null> {
  // If the environment variable for disabling live updates is provided, then
  // ensure we don't permit changes to the database model.
  if (
    config.get("disable_live_updates") &&
    input.live &&
    !isUndefined(input.live.enabled)
  ) {
    delete input.live.enabled;
  }

  const updatedTenant = await updateTenant(mongo, tenant.id, input);
  if (!updatedTenant) {
    return null;
  }

  // Update the tenant cache.
  await cache.update(redis, updatedTenant);

  return updatedTenant;
}

export type InstallTenant = CreateTenantInput;

export async function install(
  mongo: Db,
  redis: Redis,
  cache: TenantCache,
  input: InstallTenant,
  now = new Date()
) {
  if (await isInstalled(cache)) {
    throw new TenantInstalledAlreadyError();
  }

  // TODO: (wyattjoh) perform any pending migrations.

  // TODO: (wyattjoh) setup database indexes.

  logger.info({ tenant: input }, "installing tenant");

  // Create the Tenant.
  const tenant = await createTenant(mongo, input, now);

  // Update the tenant cache.
  await cache.update(redis, tenant);

  logger.info({ tenant }, "a tenant has been installed");

  return tenant;
}

/**
 * canInstall will return a promise that determines if a given install can
 * proceed.
 */
export async function canInstall(cache: TenantCache) {
  return (await cache.count()) === 0;
}

/**
 * isInstalled will return a promise that if true, indicates that a Tenant has
 * been installed.
 */
export async function isInstalled(cache: TenantCache) {
  return (await cache.count()) > 0;
}

/**
 * regenerateSSOKey will regenerate the Single Sign-On key for the specified
 * Tenant and notify all other Tenant's connected that the Tenant was updated.
 */
export async function regenerateSSOKey(
  mongo: Db,
  redis: Redis,
  cache: TenantCache,
  tenant: Tenant
) {
  const updatedTenant = await regenerateTenantSSOKey(mongo, tenant.id);
  if (!updatedTenant) {
    return null;
  }

  // Update the tenant cache.
  await cache.update(redis, updatedTenant);

  return updatedTenant;
}

/**
 * discoverOIDCConfiguration will discover the OpenID Connect configuration as
 * is required by any OpenID Connect compatible service:
 *
 * https://openid.net/specs/openid-connect-discovery-1_0.html#ProviderConfig
 *
 * @param issuerString the issuer that should be used as the discovery root.
 */
export async function discoverOIDCConfiguration(issuerString: string) {
  // Parse the issuer.
  const issuer = new URL(issuerString);

  // Discover the configuration.
  return discover(issuer);
}
