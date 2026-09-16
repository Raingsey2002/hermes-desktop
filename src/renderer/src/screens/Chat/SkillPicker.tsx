import { memo, useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";
import { Puzzle } from "../../assets/icons";
import { useI18n } from "../../components/useI18n";

interface InstalledSkill {
  name: string;
  category: string;
  description: string;
  path: string;
}

interface SkillPickerProps {
  profile?: string;
  // Invoked with the picked skill's name; the caller sets the composer text
  // to `/<name> ` so it goes through the existing slash-command → skill
  // execution path (slashExec.ts's `case "skill"`) unchanged.
  onSelectSkill: (name: string) => void;
}

/**
 * Chat-input popover listing installed skills, mirroring ModelPicker /
 * ReasoningEffortPicker's trigger-button-plus-dropdown shape. Skills were
 * previously invocable only by typing `/skill-name` from memory — this adds
 * a discoverable "what's available" affordance without changing how a skill
 * actually runs.
 */
export const SkillPicker = memo(function SkillPicker({
  profile,
  onSelectSkill,
}: SkillPickerProps): React.JSX.Element {
  const { t } = useI18n();
  const [isOpen, setIsOpen] = useState(false);
  const [skills, setSkills] = useState<InstalledSkill[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  const pickerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    searchRef.current?.focus();
    function handleClickOutside(e: MouseEvent): void {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    function handleKeyDown(e: KeyboardEvent): void {
      if (e.key === "Escape") {
        e.stopPropagation();
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [isOpen]);

  function toggle(): void {
    const next = !isOpen;
    setIsOpen(next);
    setSearchInput("");
    if (next) {
      setLoading(true);
      void window.hermesAPI
        .listInstalledSkills(profile)
        .then(setSkills)
        .finally(() => setLoading(false));
    }
  }

  function select(name: string): void {
    onSelectSkill(name);
    setIsOpen(false);
    setSearchInput("");
  }

  const query = searchInput.trim().toLowerCase();
  const visibleSkills = query
    ? skills.filter(
        (s) =>
          s.name.toLowerCase().includes(query) ||
          s.description.toLowerCase().includes(query) ||
          s.category.toLowerCase().includes(query),
      )
    : skills;

  return (
    <div className="chat-skill-bar" ref={pickerRef}>
      <button
        type="button"
        className="btn-ghost chat-skill-trigger"
        onClick={toggle}
        title={t("chat.skillPicker.title")}
      >
        <Puzzle size={14} />
      </button>

      {isOpen && (
        <div
          className="chat-model-dropdown chat-skill-dropdown"
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation();
              setIsOpen(false);
            }
          }}
        >
          <div className="chat-model-search-wrap">
            <Search size={14} className="chat-model-search-icon" aria-hidden />
            <input
              ref={searchRef}
              className="chat-model-search-input"
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.stopPropagation();
                  setIsOpen(false);
                }
              }}
              placeholder={t("chat.skillPicker.search")}
            />
          </div>

          <div className="chat-skill-list">
            {loading ? (
              <div className="chat-model-list-empty">
                {t("chat.skillPicker.loading")}
              </div>
            ) : visibleSkills.length === 0 ? (
              <div className="chat-model-list-empty">
                {skills.length === 0
                  ? t("chat.skillPicker.none")
                  : t("chat.skillPicker.noMatch")}
              </div>
            ) : (
              visibleSkills.map((s) => (
                <button
                  type="button"
                  key={`${s.category}/${s.name}`}
                  className="chat-model-row"
                  onClick={() => select(s.name)}
                >
                  <span className="chat-model-row-body">
                    <span className="chat-model-row-title">{s.name}</span>
                    {s.description && (
                      <span className="chat-model-row-sub">
                        {s.description}
                      </span>
                    )}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
});

export default SkillPicker;
