export const INSTITUTE_STORAGE_KEY = "au-race-institute";

// Institutter på Faculty of Health. `building` er OSM-navnet på institutbygningen, hvis den findes i kortdata.
// `color` er kartfarven; den følger institutten, så man kan se, hvem der kører hurtigt.
export const INSTITUTES: readonly { id: string; name: string; label: string; color: string; building?: string }[] = [
  { id: "klinisk-medicin", name: "Klinisk Medicin", label: "Klinisk Medicin", color: "#ff8a4c" },
  { id: "biomedicin", name: "Biomedicin", label: "Biomedicin", color: "#33c9c0", building: "Institut for Biomedicin" },
  { id: "odontologi", name: "Odontologi og Oral Sundhed", label: "Odontologi", color: "#a66bff" },
  { id: "folkesundhed", name: "Folkesundhed", label: "Folkesundhed", color: "#8fe03c", building: "Institut for Folkesundhed" },
  { id: "retsmedicin", name: "Retsmedicin", label: "Retsmedicin", color: "#f4f1e0" },
];

export const NO_INSTITUTE_COLOR = "#9aa5a0";

export function instituteById(id: unknown): (typeof INSTITUTES)[number] | undefined {
  return INSTITUTES.find((institute) => institute.id === id);
}

/** Navnet efterfulgt af institutten, fx "Anna · Biomedicin". */
export function playerLabel(player: { name: string; institute?: string }): string {
  const institute = instituteById(player.institute);
  return institute ? `${player.name} · ${institute.label}` : player.name;
}

export function selectedInstitute(): (typeof INSTITUTES)[number] | undefined {
  try {
    const id = localStorage.getItem(INSTITUTE_STORAGE_KEY);
    return INSTITUTES.find((institute) => institute.id === id);
  } catch {
    return undefined;
  }
}

export function saveInstitute(id: string): void {
  try {
    localStorage.setItem(INSTITUTE_STORAGE_KEY, id);
  } catch {
    // Lagring er ikke tilgængelig (fx privat tilstand); valget gælder kun denne session.
  }
}
