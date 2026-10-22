import { afterEach, expect, it, vi } from "vitest";
import { findTourTarget } from "../src/lib/tour-target";

afterEach(() => { document.body.innerHTML = ""; vi.restoreAllMocks(); });

it("chooses the rendered navigation link when desktop and phone share a target", () => {
  document.body.innerHTML = '<nav style="display:none"><a data-tour="library">desktop</a></nav><nav><a data-tour="library">phone</a></nav>';
  const links = document.querySelectorAll<HTMLElement>("a");
  vi.spyOn(links[0], "getBoundingClientRect").mockReturnValue(new DOMRect());
  vi.spyOn(links[1], "getBoundingClientRect").mockReturnValue(new DOMRect(140, 60, 110, 44));
  expect(findTourTarget('[data-tour="library"]')).toBe(links[1]);
});

it.each(['inert', 'aria-hidden="true"', 'style="visibility:hidden"', 'style="opacity:0"'])("ignores an inactive carousel slide (%s) even when it retains geometry", (attrs) => {
  document.body.innerHTML = `<div ${attrs}><button data-tour="home-roll">roll</button></div>`;
  vi.spyOn(document.querySelector("button")!, "getBoundingClientRect").mockReturnValue(new DOMRect(28, 325, 115, 32));
  expect(findTourTarget('[data-tour="home-roll"]')).toBeNull();
});

it("ignores missing and zero-size targets and reselects after a responsive layout change", () => {
  expect(findTourTarget(".absent")).toBeNull();
  document.body.innerHTML = '<a data-tour="library">desktop</a><a data-tour="library">phone</a>';
  const [desktop, phone] = document.querySelectorAll<HTMLElement>("a");
  const a = vi.spyOn(desktop, "getBoundingClientRect").mockReturnValue(new DOMRect());
  const b = vi.spyOn(phone, "getBoundingClientRect").mockReturnValue(new DOMRect(140, 60, 110, 44));
  expect(findTourTarget('[data-tour="library"]')).toBe(phone);
  a.mockReturnValue(new DOMRect(260, 8, 110, 44)); b.mockReturnValue(new DOMRect());
  expect(findTourTarget('[data-tour="library"]')).toBe(desktop);
});
