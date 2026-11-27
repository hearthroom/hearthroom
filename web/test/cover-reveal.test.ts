import { afterEach, expect, it } from "vitest";
import { effectScope, ref } from "vue";
import { useCoverReveal } from "@/lib/cover-reveal";

afterEach(() => sessionStorage.clear());

it("shares a reveal across list tiles for the same cover and hides replacement art", () => {
  const id = ref("100001");
  const url = ref("https://fixture.test/cover.png");
  const sensitive = ref(true);
  const scope = effectScope();
  scope.run(() => {
    const a = useCoverReveal(() => id.value, () => url.value, () => sensitive.value);
    const b = useCoverReveal(() => id.value, () => url.value, () => sensitive.value);
    expect(a.concealed.value).toBe(true);
    a.reveal();
    expect(b.concealed.value).toBe(false);
    url.value = "https://fixture.test/replaced.png";
    expect(b.concealed.value).toBe(true);
    sensitive.value = false;
    expect(b.concealed.value).toBe(false);
  });
  scope.stop();
});
