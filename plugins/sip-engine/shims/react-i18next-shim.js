var ri18n = window.__AGENTLABS_REACT_I18NEXT__ || { useTranslation: function() { return { t: function(k) { return k; }, i18n: { language: 'en', changeLanguage: function() {} } }; } };
export default ri18n;
export var useTranslation = ri18n.useTranslation;
export var Trans = ri18n.Trans;
