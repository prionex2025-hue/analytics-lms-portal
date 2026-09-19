const LOOKUP_STOP_WORDS = new Set(["and", "of", "the", "department", "dept"]);

const COMMON_DEPARTMENT_ALIASES = {
  cse: ["computerscience", "computerscienceengineering", "computerengineering"],
  cs: ["computerscience"],
  it: ["informationtechnology"],
  ece: ["electronicscommunicationengineering", "electronicsandcommunicationengineering"],
  eee: ["electricalelectronicsengineering", "electricalandelectronicsengineering"],
  mech: ["mechanicalengineering"],
  civil: ["civilengineering"],
  aiml: ["artificialintelligencemachinelearning", "artificialintelligenceandmachinelearning", "aimachinelearning"],
  aids: ["artificialintelligencedatascience", "artificialintelligenceanddatascience", "aidatascience"],
  ds: ["datascience"],
  mba: ["masterbusinessadministration", "masterofbusinessadministration"],
  bba: ["businessadministration", "bachelorbusinessadministration", "bachelorofbusinessadministration"],
};

const normalizeImportLookupValue = (value) =>
  String(value ?? "")
    .normalize("NFKC")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const tokenizeLookupWords = (value) =>
  normalizeImportLookupValue(value)
    .replace(/&/g, " and ")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.toLowerCase());

const normalizeImportLookupKey = (value) =>
  normalizeImportLookupValue(value)
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]/g, "");

const getLabelDirectLookupKeys = (value) => {
  const normalizedKey = normalizeImportLookupKey(value);
  const words = tokenizeLookupWords(value);
  const canonicalWords = words.filter((word) => !LOOKUP_STOP_WORDS.has(word));
  const compactCanonical = canonicalWords.join("");

  return [...new Set([normalizedKey, compactCanonical].filter(Boolean))];
};

const getLabelAliasLookupKeys = (value) => {
  const words = tokenizeLookupWords(value);
  const canonicalWords = words.filter((word) => !LOOKUP_STOP_WORDS.has(word));
  const acronym = canonicalWords.length > 1 ? canonicalWords.map((word) => word[0]).join("") : "";

  return acronym ? [acronym] : [];
};

const getLabelLookupKeys = (value) => {
  return [...new Set([...getLabelDirectLookupKeys(value), ...getLabelAliasLookupKeys(value)])];
};

const getIdLookupKeys = (value) => [normalizeImportLookupKey(value)].filter(Boolean);

const addLookupEntry = (lookupMap, key, value) => {
  if (!key) return;

  const existing = lookupMap.get(key);
  if (existing && String(existing.id) !== String(value.id)) {
    lookupMap.set(key, null);
    return;
  }

  if (!lookupMap.has(key)) {
    lookupMap.set(key, value);
  }
};

const getDepartmentDirectLookupKeys = (department) => [
  ...getIdLookupKeys(department?.id),
  ...getLabelDirectLookupKeys(department?.name),
];

const getDepartmentAliasLookupKeys = (department) => {
  const keys = [
    ...getLabelAliasLookupKeys(department?.name),
  ];
  const canonicalNameKeys = getLabelDirectLookupKeys(department?.name);

  for (const [alias, targets] of Object.entries(COMMON_DEPARTMENT_ALIASES)) {
    if (targets.some((target) => canonicalNameKeys.includes(target))) {
      keys.push(alias);
    }
  }

  return [...new Set(keys.filter(Boolean))];
};

const buildDepartmentLookupIndex = (departments = []) => {
  const byDirectLookup = new Map();
  const byAliasLookup = new Map();

  for (const department of departments) {
    for (const key of getDepartmentDirectLookupKeys(department)) {
      addLookupEntry(byDirectLookup, key, department);
    }

    for (const key of getDepartmentAliasLookupKeys(department)) {
      addLookupEntry(byAliasLookup, key, department);
    }
  }

  return { departments, byDirectLookup, byAliasLookup };
};

const resolveDepartmentLookup = (lookupValue, departmentIndex) => {
  const lookupKeys = getLabelLookupKeys(lookupValue);
  for (const key of lookupKeys) {
    const department = departmentIndex?.byDirectLookup?.get(key);
    if (department) return department;
  }

  for (const key of lookupKeys) {
    const department = departmentIndex?.byAliasLookup?.get(key);
    if (department) return department;
  }
  return null;
};

const getInvalidDepartmentReason = (lookupValue, departments = []) => {
  const available = departments
    .map((department) => normalizeImportLookupValue(department?.name))
    .filter(Boolean)
    .slice(0, 8)
    .join(", ");

  const supplied = normalizeImportLookupValue(lookupValue);
  const base = supplied ? `Invalid department "${supplied}"` : "Department is required";
  return available ? `${base}. Use one of: ${available}` : base;
};

const batchBelongsToDepartment = (batch, departmentId) => {
  if (!batch || !departmentId) return false;
  if (String(batch.departmentId || "") === String(departmentId)) return true;
  if (!batch.isGlobal || !Array.isArray(batch.departmentIds)) return false;
  return batch.departmentIds.some((id) => String(id) === String(departmentId));
};

const resolveBatchLookup = (lookupValue, batches = [], departmentId) => {
  if (!lookupValue) return null;

  const lookupKeys = getLabelLookupKeys(lookupValue);
  for (const batch of batches) {
    if (!batchBelongsToDepartment(batch, departmentId)) continue;

    const batchKeys = [
      ...getLabelLookupKeys(batch?.id),
      ...getLabelLookupKeys(batch?.name),
    ];

    if (lookupKeys.some((key) => batchKeys.includes(key))) {
      return batch;
    }
  }

  return null;
};

module.exports = {
  buildDepartmentLookupIndex,
  getInvalidDepartmentReason,
  normalizeImportLookupKey,
  resolveBatchLookup,
  resolveDepartmentLookup,
};
