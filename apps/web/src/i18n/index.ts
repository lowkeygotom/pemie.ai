import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import accountEn from "./en/account.js";
import commonEn from "./en/common.js";
import reportsEn from "./en/reports.js";
import projectEn from "./en/project.js";
import accountEs from "./es/account.js";
import commonEs from "./es/common.js";
import reportsEs from "./es/reports.js";
import projectEs from "./es/project.js";

/** Los diccionarios se dividen por feature; `common` queda para chrome reutilizable. */
void i18n.use(initReactI18next).init({
  resources: {
    es: { common: commonEs, account: accountEs, reports: reportsEs, project: projectEs },
    en: { common: commonEn, account: accountEn, reports: reportsEn, project: projectEn },
  },
  lng: "es",
  fallbackLng: "es",
  defaultNS: "common",
  interpolation: { escapeValue: false },
});

export default i18n;
