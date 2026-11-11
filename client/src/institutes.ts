export const INSTITUTE_STORAGE_KEY = "au-race-institute";

// Institutter på Faculty of Health. `building` er OSM-navnet på institutbygningen, hvis den findes i kortdata.
export const INSTITUTES: readonly { id: string; name: string; building?: string }[] = [
  { id: "klinisk-medicin", name: "Klinisk Medicin" },
  { id: "biomedicin", name: "Biomedicin", building: "Institut for Biomedicin" },
  { id: "odontologi", name: "Odontologi og Oral Sundhed" },
  { id: "folkesundhed", name: "Folkesundhed", building: "Institut for Folkesundhed" },
  { id: "retsmedicin", name: "Retsmedicin" },
];

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
