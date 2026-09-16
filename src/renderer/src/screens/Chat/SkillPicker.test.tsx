import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../components/useI18n", () => ({
  useI18n: () => ({
    t: (key: string) => key,
    locale: "en",
    setLocale: vi.fn(),
  }),
}));

import { SkillPicker } from "./SkillPicker";

afterEach(cleanup);

interface InstalledSkill {
  name: string;
  category: string;
  description: string;
  path: string;
}

function stubSkills(skills: InstalledSkill[]): ReturnType<typeof vi.fn> {
  const listInstalledSkills = vi.fn().mockResolvedValue(skills);
  (window as unknown as { hermesAPI: unknown }).hermesAPI = {
    listInstalledSkills,
  };
  return listInstalledSkills;
}

// W4-5: the picker fills the composer with `/<name> ` for the user to review
// and send themselves — it never sends on its own behalf, and the runtime
// receives the selection only through the existing slash-command pipeline,
// so these tests assert on onSelectSkill(name) rather than any send call.
// @lat: [[skills#Skills#Chat-input skill picker]]
describe("SkillPicker", () => {
  it("does not fetch until opened", () => {
    const listInstalledSkills = stubSkills([]);
    render(<SkillPicker onSelectSkill={vi.fn()} />);
    expect(listInstalledSkills).not.toHaveBeenCalled();
  });

  it("fetches the active profile's installed skills on open", () => {
    const listInstalledSkills = stubSkills([]);
    render(<SkillPicker profile="research" onSelectSkill={vi.fn()} />);

    fireEvent.click(screen.getByTitle("chat.skillPicker.title"));

    expect(listInstalledSkills).toHaveBeenCalledWith("research");
  });

  it("lists fetched skills and reports the picked name, not a sent message", async () => {
    stubSkills([
      { name: "pdf", category: "docs", description: "PDF tools", path: "" },
      { name: "web", category: "docs", description: "", path: "" },
    ]);
    const onSelectSkill = vi.fn();
    render(<SkillPicker onSelectSkill={onSelectSkill} />);

    fireEvent.click(screen.getByTitle("chat.skillPicker.title"));
    await screen.findByText("pdf");

    fireEvent.click(screen.getByText("pdf"));

    expect(onSelectSkill).toHaveBeenCalledWith("pdf");
    expect(onSelectSkill).toHaveBeenCalledTimes(1);
  });

  it("filters the list by the search query", async () => {
    stubSkills([
      { name: "pdf", category: "docs", description: "", path: "" },
      { name: "web-search", category: "docs", description: "", path: "" },
    ]);
    render(<SkillPicker onSelectSkill={vi.fn()} />);

    fireEvent.click(screen.getByTitle("chat.skillPicker.title"));
    await screen.findByText("pdf");

    fireEvent.change(screen.getByPlaceholderText("chat.skillPicker.search"), {
      target: { value: "web" },
    });

    expect(screen.queryByText("pdf")).toBeNull();
    expect(screen.getByText("web-search")).toBeTruthy();
  });

  it("shows the empty-state message when nothing is installed", async () => {
    stubSkills([]);
    render(<SkillPicker onSelectSkill={vi.fn()} />);

    fireEvent.click(screen.getByTitle("chat.skillPicker.title"));

    await screen.findByText("chat.skillPicker.none");
  });

  it("closes the popover after a selection", async () => {
    stubSkills([{ name: "pdf", category: "docs", description: "", path: "" }]);
    render(<SkillPicker onSelectSkill={vi.fn()} />);

    fireEvent.click(screen.getByTitle("chat.skillPicker.title"));
    await screen.findByText("pdf");
    fireEvent.click(screen.getByText("pdf"));

    expect(screen.queryByText("pdf")).toBeNull();
  });
});
