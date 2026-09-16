/**
 * Профиль развёртывания (ADR-R-015).
 *
 * «Подключить несколько строительных компаний» имеет два разных смысла:
 *  · `single-tenant-onprem` — одна инсталляция = одна компания в её контуре.
 *    Для АПРИ это требование ТЗ §6.1 и КП; несколько компаний на одной установке
 *    там контрактно недопустимы.
 *  · `multi-tenant` — одна инсталляция обслуживает несколько компаний.
 *
 * Код один, различает конфигурация. Запрет второго арендатора в on-prem
 * обеспечивается приложением, а не соглашением.
 */
const PROFILES = ["single-tenant-onprem", "multi-tenant", "development"] as const;

export type DeploymentProfile = (typeof PROFILES)[number];

const ENV_KEY = "STROYINTELLECT_DEPLOYMENT_PROFILE";

export function deploymentProfile(env: NodeJS.ProcessEnv = process.env): DeploymentProfile {
  const value = env[ENV_KEY] ?? "development";

  if (!(PROFILES as readonly string[]).includes(value)) {
    throw new Error(
      `Недопустимый ${ENV_KEY}: ${JSON.stringify(value)}. Ожидается один из: ${PROFILES.join(", ")}`,
    );
  }

  return value as DeploymentProfile;
}

/** Сколько арендаторов разрешено профилем. */
export function maxTenants(profile: DeploymentProfile): number {
  return profile === "multi-tenant" ? Number.POSITIVE_INFINITY : 1;
}

/**
 * Проверяется перед созданием арендатора. В `single-tenant-onprem` второй
 * арендатор невозможен — это граница контура заказчика, а не настройка.
 */
export function assertCanCreateTenant(profile: DeploymentProfile, existingTenants: number): void {
  const limit = maxTenants(profile);

  if (existingTenants >= limit) {
    throw new Error(
      `Профиль ${profile} допускает не более ${limit} арендатора; уже существует ${existingTenants}. ` +
        "Несколько компаний на одной инсталляции требуют профиля multi-tenant.",
    );
  }
}

export const DEPLOYMENT_PROFILES = PROFILES;
