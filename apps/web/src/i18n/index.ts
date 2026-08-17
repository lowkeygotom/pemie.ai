import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import accountEn from "./en/account.js";
import commonEn from "./en/common.js";
import reportsEn from "./en/reports.js";
import projectEn from "./en/project.js";
import collaborationEn from "./en/collaboration.js";
import searchEn from "./en/search.js";
import agentsEn from "./en/agents.js";
import commitsEn from "./en/commits.js";
import configurationEn from "./en/configuration.js";
import configurationKeysEn from "./en/configuration-keys.js";
import workspacesEn from "./en/workspaces.js";
import accountEs from "./es/account.js";
import commonEs from "./es/common.js";
import reportsEs from "./es/reports.js";
import projectEs from "./es/project.js";
import collaborationEs from "./es/collaboration.js";
import searchEs from "./es/search.js";
import agentsEs from "./es/agents.js";
import commitsEs from "./es/commits.js";
import configurationEs from "./es/configuration.js";
import configurationKeysEs from "./es/configuration-keys.js";
import workspacesEs from "./es/workspaces.js";

/** Los diccionarios se dividen por feature; `common` queda para chrome reutilizable. */
void i18n.use(initReactI18next).init({
  resources: {
    es: { common: commonEs, account: accountEs, reports: reportsEs, project: projectEs, collaboration: collaborationEs, search: searchEs, agents: agentsEs, commits: commitsEs, workspaces: workspacesEs, configuration: { ...configurationEs, ...configurationKeysEs } },
    en: { common: commonEn, account: accountEn, reports: reportsEn, project: projectEn, collaboration: collaborationEn, search: searchEn, agents: agentsEn, commits: commitsEn, workspaces: workspacesEn, configuration: { ...configurationEn, ...configurationKeysEn } },
  },
  lng: "es",
  fallbackLng: "es",
  defaultNS: "common",
  interpolation: { escapeValue: false },
});

export default i18n;
