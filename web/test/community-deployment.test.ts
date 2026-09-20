import config from "../../wrangler.toml?raw";
import { expect, it } from "vitest";
it("routes signed community bridge requests to the Worker before SPA assets", () => {
  const paths = config.match(/run_worker_first\s*=\s*\[([\s\S]*?)\]/)?.[1] ?? "";
  expect(paths).toContain('"/internal/community/*"');
});
