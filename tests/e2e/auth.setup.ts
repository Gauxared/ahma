/**
 * Вход по одному разу на роль — проект `вход` конфигурации Playwright.
 *
 * Он же остаётся ГЕЙТОМ САМОЙ ФОРМЫ: если вход сломан, состояний не появится и
 * весь набор не стартует. То есть отказ от повторных входов не убрал проверку
 * входа, а перенёс её в одно место и сделал условием запуска остальных.
 */
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { test as setup } from "@playwright/test";

import { ADMIN, signInThroughForm, stateFile, USER } from "./support/auth.js";

for (const email of [USER, ADMIN]) {
  setup(`вход ${email}`, async ({ page }) => {
    await signInThroughForm(page, email);

    const file = stateFile(email);
    mkdirSync(dirname(file), { recursive: true });
    await page.context().storageState({ path: file });
  });
}
