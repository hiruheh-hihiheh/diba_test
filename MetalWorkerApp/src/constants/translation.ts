export type Language = "en" | "hi";

export interface TranslationDictionary {
  // LOGIN
  app_name: string;
  login_subtitle: string;
  username: string;
  password: string;
  enter_username: string;
  enter_password: string;
  login: string;
  logging_in: string;
  wrong_credentials: string;
  enter_username_password: string;
  login_failed: string;
  please_try_again: string;
  something_went_wrong: string;

  // DASHBOARD
  good_morning: string;
  active_online: string;
  ready_to_log: string;
  quick_actions: string;
  new_dispatch: string;
  log_new_sale: string;
  my_history: string;
  view_past_logs: string;
  scan_qr: string;
  scan_truck_item: string;
  profile: string;
  settings_info: string;
  recent_activity: string;
  no_recent_dispatches: string;
  submitted_logs_appear_here: string;
  logout: string;
  logging_out: string;
  logout_failed: string;
  unable_to_logout: string;

  // LANGUAGE
  language_english: string;
  language_hindi: string;
}

export const translations: Record<Language, TranslationDictionary> = {
  en: {
    // LOGIN
    app_name: "Metal Worker",
    login_subtitle: "Login to your account",
    username: "Username",
    password: "Password",
    enter_username: "Enter username",
    enter_password: "Enter password",
    login: "Login",
    logging_in: "Logging in...",
    wrong_credentials: "Wrong username or password",
    enter_username_password: "Please enter username and password",
    login_failed: "Login failed",
    please_try_again: "Please try again",
    something_went_wrong: "Something went wrong",

    // DASHBOARD
    good_morning: "Good Morning",
    active_online: "Active & Online",
    ready_to_log: "You are ready to log dispatches",
    quick_actions: "Quick Actions",
    new_dispatch: "New Dispatch",
    log_new_sale: "Log a new metal sale",
    my_history: "My History",
    view_past_logs: "View past logs",
    scan_qr: "Scan QR",
    scan_truck_item: "Scan truck/item",
    profile: "Profile",
    settings_info: "Settings & info",
    recent_activity: "Recent Activity",
    no_recent_dispatches: "No recent dispatches",
    submitted_logs_appear_here: "Your submitted logs will appear here",
    logout: "Logout",
    logging_out: "Logging out...",
    logout_failed: "Logout Failed",
    unable_to_logout: "Unable to logout",

    // LANGUAGE
    language_english: "English",
    language_hindi: "हिंदी",
  },
  hi: {
    // LOGIN
    app_name: "मेटल वर्कर",
    login_subtitle: "अपने खाते में लॉगिन करें",
    username: "उपयोगकर्ता नाम",
    password: "पासवर्ड",
    enter_username: "उपयोगकर्ता नाम दर्ज करें",
    enter_password: "पासवर्ड दर्ज करें",
    login: "लॉगिन करें",
    logging_in: "लॉगिन हो रहा है...",
    wrong_credentials: "गलत उपयोगकर्ता नाम या पासवर्ड",
    enter_username_password: "कृपया उपयोगकर्ता नाम और पासवर्ड दर्ज करें",
    login_failed: "लॉगिन विफल",
    please_try_again: "कृपया पुनः प्रयास करें",
    something_went_wrong: "कुछ गलत हो गया",

    // DASHBOARD
    good_morning: "शुभ प्रभात",
    active_online: "सक्रिय और ऑनलाइन",
    ready_to_log: "आप डिस्पैच लॉग करने के लिए तैयार हैं",
    quick_actions: "त्वरित कार्य",
    new_dispatch: "नया डिस्पैच",
    log_new_sale: "नई धातु बिक्री लॉग करें",
    my_history: "मेरा इतिहास",
    view_past_logs: "पुराने लॉग देखें",
    scan_qr: "QR स्कैन करें",
    scan_truck_item: "ट्रक/आइटम स्कैन करें",
    profile: "प्रोफाइल",
    settings_info: "सेटिंग्स और जानकारी",
    recent_activity: "हाल की गतिविधि",
    no_recent_dispatches: "कोई हालिया डिस्पैच नहीं",
    submitted_logs_appear_here: "आपके जमा किए गए लॉग यहाँ दिखाई देंगे",
    logout: "लॉगआउट",
    logging_out: "लॉगआउट हो रहा है...",
    logout_failed: "लॉगआउट विफल",
    unable_to_logout: "लॉगआउट करने में असमर्थ",

    // LANGUAGE
    language_english: "English",
    language_hindi: "हिंदी",
  },
};

export function getTranslations(language: Language): TranslationDictionary {
  return translations[language] || translations.en;
}