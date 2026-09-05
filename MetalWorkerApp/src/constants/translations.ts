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

  // DISPATCH
  back: string;
  take_photo: string;
  retake_photo: string;
  vehicle_number: string;
  enter_vehicle_number: string;
  material_type: string;
  select_material: string;
  scrap_metal: string;
  ferrous_metal: string;
  non_ferrous_metal: string;
  other: string;
  current_location: string;
  location_captured: string;
  getting_location: string;
  location_unavailable: string;
  date_time: string;
  auto_captured: string;
  review_dispatch: string;
  submit_dispatch: string;
  submitting: string;
  complete_required_fields: string;
  photo_required: string;
  vehicle_required: string;
  material_required: string;
  camera_error: string;
  location_error: string;
  
  // DISPATCH SUBMISSION & ERRORS
  success_title: string;
  dispatch_submitted_successfully: string;
  photo_upload_failed: string;
  dispatch_save_failed: string;
  check_internet: string;
  
  // NEW SUCCESS & RECENT ACTIVITY KEYS
  uploading_photo: string;
  saving_dispatch: string;
  dispatch_submitted: string;
  your_dispatch_recorded: string;
  back_to_dashboard: string;
  retry: string;
  recent_dispatches: string;
  status_submitted: string;
  status_reviewed: string;
  status_approved: string;
  status_rejected: string;
  failed_to_load_dispatches: string;

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

    // DISPATCH
    back: "Back",
    take_photo: "Take Photo",
    retake_photo: "Retake Photo",
    vehicle_number: "Vehicle Number",
    enter_vehicle_number: "Enter vehicle number",
    material_type: "Material Type",
    select_material: "Select material",
    scrap_metal: "Scrap Metal",
    ferrous_metal: "Ferrous Metal",
    non_ferrous_metal: "Non-Ferrous Metal",
    other: "Other",
    current_location: "Current Location",
    location_captured: "Location captured",
    getting_location: "Getting location...",
    location_unavailable: "Location unavailable",
    date_time: "Date & Time",
    auto_captured: "Automatically captured",
    review_dispatch: "Review Dispatch",
    submit_dispatch: "Submit Dispatch",
    submitting: "Submitting...",
    complete_required_fields: "Please complete all required fields",
    photo_required: "Photo required",
    vehicle_required: "Vehicle number required",
    material_required: "Material type required",
    camera_error: "Could not access camera",
    location_error: "Could not access location",
    
    // DISPATCH SUBMISSION & ERRORS
    success_title: "Success",
    dispatch_submitted_successfully: "Dispatch submitted successfully.",
    photo_upload_failed: "Could not upload the photo. Please try again.",
    dispatch_save_failed: "Could not save the dispatch. Please try again.",
    check_internet: "Please check your internet connection.",
    
    // NEW SUCCESS & RECENT ACTIVITY KEYS
    uploading_photo: "Uploading photo...",
    saving_dispatch: "Saving dispatch...",
    dispatch_submitted: "Dispatch Submitted",
    your_dispatch_recorded: "Your dispatch has been successfully recorded.",
    back_to_dashboard: "Back to Dashboard",
    retry: "Retry",
    recent_dispatches: "Recent Dispatches",
    status_submitted: "Submitted",
    status_reviewed: "Reviewed",
    status_approved: "Approved",
    status_rejected: "Rejected",
    failed_to_load_dispatches: "Failed to load dispatches",

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

    // DISPATCH
    back: "वापस",
    take_photo: "फोटो लें",
    retake_photo: "फोटो बदलें",
    vehicle_number: "वाहन नंबर",
    enter_vehicle_number: "वाहन नंबर दर्ज करें",
    material_type: "सामग्री का प्रकार",
    select_material: "सामग्री चुनें",
    scrap_metal: "स्क्रेप धातु",
    ferrous_metal: "लोहे की धातु",
    non_ferrous_metal: "गैर-लोहे की धातु",
    other: "अन्य",
    current_location: "वर्तमान स्थान",
    location_captured: "स्थान मिल गया",
    getting_location: "स्थान खोजा जा रहा है...",
    location_unavailable: "स्थान नहीं मिला",
    date_time: "दिनांक और समय",
    auto_captured: "स्वचालित रूप से लिया गया",
    review_dispatch: "डिस्पैच की समीक्षा",
    submit_dispatch: "डिस्पैच जमा करें",
    submitting: "जमा हो रहा है...",
    complete_required_fields: "कृपया सभी जरूरी जानकारी भरें",
    photo_required: "फोटो जरूरी है",
    vehicle_required: "वाहन नंबर जरूरी है",
    material_required: "सामग्री चुनना जरूरी है",
    camera_error: "कैमरा चालू नहीं हो सका",
    location_error: "स्थान की अनुमति नहीं मिली",
    
    // DISPATCH SUBMISSION & ERRORS
    success_title: "सफलता",
    dispatch_submitted_successfully: "डिस्पैच सफलतापूर्वक जमा हो गया।",
    photo_upload_failed: "फोटो अपलोड नहीं हो सकी। कृपया पुनः प्रयास करें।",
    dispatch_save_failed: "डिस्पैच सेव नहीं हो सका। कृपया पुनः प्रयास करें।",
    check_internet: "कृपया अपना इंटरनेट कनेक्शन जांचें।",
    
    // NEW SUCCESS & RECENT ACTIVITY KEYS
    uploading_photo: "फोटो अपलोड हो रही है...",
    saving_dispatch: "डिस्पैच सेव हो रहा है...",
    dispatch_submitted: "डिस्पैच जमा हो गया",
    your_dispatch_recorded: "आपका डिस्पैच सफलतापूर्वक दर्ज कर लिया गया है।",
    back_to_dashboard: "डैशबोर्ड पर वापस जाएं",
    retry: "पुनः प्रयास करें",
    recent_dispatches: "हाल के डिस्पैच",
    status_submitted: "जमा किया गया",
    status_reviewed: "समीक्षा की गई",
    status_approved: "स्वीकृत",
    status_rejected: "अस्वीकृत",
    failed_to_load_dispatches: "डिस्पैच लोड करने में विफल",

    // LANGUAGE
    language_english: "English",
    language_hindi: "हिंदी",
  },
};

export function getTranslations(language: Language): TranslationDictionary {
  return translations[language] || translations.en;
}