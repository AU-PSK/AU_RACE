import { expect, test } from "@playwright/test";

interface AuRaceHook {
  state: () => { phase: string; players: Map<string, { progress: number; speed: number }> } | null;
  me: () => string;
  autopilot: (on: boolean) => void;
}

test("solo race loads the lazy scene and a kart drives without errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });

  await page.goto("/");
  await page.fill("#nickname", "Tester");
  await page.click("#trial-button");
  await expect(page.locator("canvas")).toBeVisible({ timeout: 30_000 });

  await page.evaluate(() => (window as unknown as { auRace: AuRaceHook }).auRace.autopilot(true));
  await page.waitForFunction(
    () => {
      const hook = (window as unknown as { auRace: AuRaceHook }).auRace;
      const player = hook.state()?.players.get(hook.me());
      return hook.state()?.phase === "racing" && !!player && player.progress > -0.95 && player.speed > 5;
    },
    undefined,
    { timeout: 40_000, polling: 500 },
  );

  expect(errors).toEqual([]);
});
