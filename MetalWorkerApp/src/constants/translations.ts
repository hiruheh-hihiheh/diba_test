export type Language = "en" | "hi";

export interface TranslationDictionary {
  // ---- LOGIN ----
  app_name: string;
  login_subtitle: string;
  username: string;
  password: string;
  enter_username: string;
  enter_password: string;
  show_password: string;
  hide_password: string;
  login: string;
  logging_in: string;
  wrong_credentials: string;
  enter_username_password: string;
  login_failed: string;
  please_try_again: string;
  something_went_wrong: string;
  username_help: string;
  account_inactive: string;
  account_not_set_up: string;
  admin_login_unsupported: string;
  no_connection: string;
  could_not_sign_in: string;

  // ---- SHARED / COMMON ----
  cancel: string;
  ok: string;
  close: string;
  retry: string;
  back: string;
  loading: string;
  refresh: string;
  refreshing: string;
  optional: string;
  required_label: string;
  search: string;
  clear_search: string;
  sign_in: string;

  // ---- DASHBOARD ----
  good_morning: string;
  good_afternoon: string;
  good_evening: string;
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
  /** Shown on the processor dashboard, where there is no dispatch data of their own. */
  processor_note: string;
  /** Shown when a user reaches a screen that their role does not allow. */
  role_not_allowed_title: string;
  role_not_allowed_body: string;
  recent_activity: string;
  no_recent_dispatches: string;
  submitted_logs_appear_here: string;
  logout: string;
  logging_out: string;
  logout_failed: string;
  unable_to_logout: string;
  coming_soon: string;
  coming_soon_scan_qr: string;
  today: string;
  yesterday: string;

  // ---- SUMMARY STRIP ----
  total_dispatches: string;
  awaiting_review: string;
  approved: string;
  rejected: string;
  open_history: string;
  first_dispatch_hint: string;

  // ---- DISPATCH FORM ----
  take_photo: string;
  retake_photo: string;
  choose_photo: string;
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
  uploading_photo: string;
  saving_dispatch: string;
  dispatch_submitted: string;
  your_dispatch_recorded: string;
  back_to_dashboard: string;
  recent_dispatches: string;
  status_submitted: string;
  status_reviewed: string;
  status_approved: string;
  status_rejected: string;
  failed_to_load_dispatches: string;

  // ---- DISPATCH FORM: validation / permissions / errors ----
  fields_missing: string;
  field_photo: string;
  field_vehicle: string;
  field_material: string;
  fix_fields_hint: string;
  photo_upload_failed: string;
  dispatch_save_failed: string;
  check_internet: string;
  offline_cannot_submit: string;
  offline_cannot_upload: string;
  photo_hint_required: string;
  camera_permission_title: string;
  camera_permission_body: string;
  photo_permission_title: string;
  photo_permission_body: string;
  location_permission_title: string;
  location_permission_body: string;
  open_settings: string;
  tap_to_edit: string;
  log_another: string;
  submitted_at_label: string;

  // ---- UNSAVED CHANGES ----
  discard_title: string;
  discard_body: string;
  keep_editing: string;
  discard: string;

  // ---- LOGOUT ----
  logout_confirm_title: string;
  logout_confirm_body: string;

  // ---- HISTORY ----
  history_title: string;
  search_dispatches: string;
  no_dispatches_yet: string;
  no_dispatches_yet_body: string;
  no_matches: string;
  no_matches_body: string;
  filter_all: string;
  load_more: string;
  showing_count: string;

  // ---- DISPATCH DETAIL ----
  dispatch_details: string;
  photo_label: string;
  status_label: string;
  location_label: string;
  not_recorded: string;
  open_dispatch: string;
  dispatch_not_found: string;
  dispatch_not_found_body: string;

  // ---- PROFILE ----
  profile_title: string;
  your_account: string;
  role_label: string;
  role_worker: string;
  role_processor: string;
  language_label: string;
  app_version: string;
  session_label: string;

  // ---- NETWORK ----
  offline_banner: string;

  // ---- LANGUAGE ----
  language_english: string;
  language_hindi: string;
}

export const translations: Record<Language, TranslationDictionary> = {
  en: {
    // ---- LOGIN ----
    app_name: "Metal Worker",
    login_subtitle: "Log in to record metal dispatches",
    username: "Username",
    password: "Password",
    enter_username: "Enter your username",
    enter_password: "Enter your password",
    show_password: "Show password",
    hide_password: "Hide password",
    login: "Log in",
    logging_in: "Logging in…",
    wrong_credentials: "That username and password do not match.",
    enter_username_password: "Enter your username and password to continue.",
    login_failed: "Could not log in",
    please_try_again: "Please try again.",
    something_went_wrong: "Something went wrong. Please try again.",
    username_help: "Your username is given to you by your supervisor. It is not your email address.",
    account_inactive: "Your account has been deactivated. Please contact your supervisor.",
    account_not_set_up: "This login is not set up for the app yet. Please contact your supervisor.",
    admin_login_unsupported: "This app is for labour and processor users. Admins use the web console.",
    no_connection: "No internet connection. Check your network and try again.",
    could_not_sign_in: "We could not sign you in. Please try again.",

    // ---- SHARED / COMMON ----
    cancel: "Cancel",
    ok: "OK",
    close: "Close",
    retry: "Try again",
    back: "Back",
    loading: "Loading…",
    refresh: "Refresh",
    refreshing: "Refreshing…",
    optional: "Optional",
    required_label: "Required",
    search: "Search",
    clear_search: "Clear search",
    sign_in: "Log in",

    // ---- DASHBOARD ----
    good_morning: "Good morning",
    good_afternoon: "Good afternoon",
    good_evening: "Good evening",
    active_online: "Ready to work",
    ready_to_log: "Tap New Dispatch to record a load.",
    quick_actions: "Quick actions",
    new_dispatch: "New Dispatch",
    log_new_sale: "Record a truck load",
    my_history: "My Dispatches",
    view_past_logs: "Search all your records",
    scan_qr: "Scan QR",
    scan_truck_item: "Scan a truck or item",
    profile: "Profile",
    settings_info: "Your account and language",
    processor_note:
      "You are signed in as a Processor. Reviewing and approving loads is done in the admin console; recording truck loads is done by Labour accounts.",
    role_not_allowed_title: "Not available for your role",
    role_not_allowed_body:
      "Only Labour accounts can record a dispatch. Go back to your dashboard.",
    recent_activity: "Recent activity",
    no_recent_dispatches: "No dispatches yet",
    submitted_logs_appear_here: "The loads you record will appear here.",
    logout: "Log out",
    logging_out: "Logging out…",
    logout_failed: "Could not log out",
    unable_to_logout: "Could not log out. Please try again.",
    coming_soon: "Coming soon",
    coming_soon_scan_qr: "Not available yet. Your supervisor will let you know when it is ready.",
    today: "Today",
    yesterday: "Yesterday",

    // ---- SUMMARY STRIP ----
    total_dispatches: "Total",
    awaiting_review: "In review",
    approved: "Approved",
    rejected: "Rejected",
    open_history: "See all",
    first_dispatch_hint: "Start by recording your first dispatch.",

    // ---- DISPATCH FORM ----
    take_photo: "Photo",
    retake_photo: "Retake photo",
    choose_photo: "Choose photo",
    vehicle_number: "Vehicle number",
    enter_vehicle_number: "e.g. DL 1L AB 1234",
    material_type: "Material type",
    select_material: "Tap the material you are loading",
    scrap_metal: "Scrap",
    ferrous_metal: "Ferrous",
    non_ferrous_metal: "Non-ferrous",
    other: "Other",
    current_location: "Current location",
    location_captured: "Location added",
    getting_location: "Getting your location…",
    location_unavailable: "Location not available",
    date_time: "Date and time",
    auto_captured: "Added automatically when you submit",
    review_dispatch: "Check your details",
    submit_dispatch: "Submit dispatch",
    submitting: "Submitting…",
    complete_required_fields: "Complete all required fields",
    photo_required: "Add a photo of the load",
    vehicle_required: "Enter the vehicle number",
    material_required: "Choose the material type",
    camera_error: "Could not open the camera",
    location_error: "Could not get your location",
    uploading_photo: "Uploading photo…",
    saving_dispatch: "Saving dispatch…",
    dispatch_submitted: "Dispatch submitted",
    your_dispatch_recorded: "Your dispatch has been recorded.",
    back_to_dashboard: "Back to dashboard",
    recent_dispatches: "Recent dispatches",
    status_submitted: "Submitted",
    status_reviewed: "In review",
    status_approved: "Approved",
    status_rejected: "Rejected",
    failed_to_load_dispatches: "Could not load your dispatches",

    // ---- DISPATCH FORM: validation / permissions / errors ----
    fields_missing: "Check the highlighted fields ({count})",
    field_photo: "Photo",
    field_vehicle: "Vehicle number",
    field_material: "Material type",
    fix_fields_hint: "The highlighted fields need your attention.",
    photo_upload_failed: "The photo did not upload. Your details are still here — try again.",
    dispatch_save_failed: "Could not save this dispatch. Your details are still here — try again.",
    check_internet: "Check your internet connection and try again.",
    offline_cannot_submit: "You are offline. Reconnect to submit this dispatch.",
    offline_cannot_upload: "You are offline. Reconnect to upload the photo.",
    photo_hint_required: "Required",
    camera_permission_title: "Camera access needed",
    camera_permission_body: "This app needs the camera to photograph the load. You can turn it on in Settings.",
    photo_permission_title: "Photo access needed",
    photo_permission_body: "This app needs your photos to attach a picture of the load. You can turn it on in Settings.",
    location_permission_title: "Location access needed",
    location_permission_body: "This app tags each dispatch with where it happened. You can turn it on in Settings.",
    open_settings: "Open Settings",
    tap_to_edit: "Tap to change",
    log_another: "Record another",
    submitted_at_label: "Submitted",

    // ---- UNSAVED CHANGES ----
    discard_title: "Discard this dispatch?",
    discard_body: "Your photo and the details you entered will not be saved.",
    keep_editing: "Keep editing",
    discard: "Discard",

    // ---- LOGOUT ----
    logout_confirm_title: "Log out?",
    logout_confirm_body: "You will need your username and password to log back in.",

    // ---- HISTORY ----
    history_title: "My Dispatches",
    search_dispatches: "Search vehicle number",
    no_dispatches_yet: "You have not recorded any dispatches yet",
    no_dispatches_yet_body: "Once you submit a dispatch it will be listed here.",
    no_matches: "No dispatches match your search",
    no_matches_body: "Check the spelling, or clear the search to see everything.",
    filter_all: "All",
    load_more: "Load more",
    showing_count: "Showing {shown} of {total}",

    // ---- DISPATCH DETAIL ----
    dispatch_details: "Dispatch details",
    photo_label: "Photo",
    status_label: "Status",
    location_label: "Location",
    not_recorded: "Not recorded",
    open_dispatch: "Open dispatch {vehicle}",
    dispatch_not_found: "Dispatch not found",
    dispatch_not_found_body: "It may have been removed. Go back to your dispatches.",

    // ---- PROFILE ----
    profile_title: "Profile",
    your_account: "Your account",
    role_label: "Role",
    role_worker: "Labour",
    role_processor: "Processor",
    language_label: "Language",
    app_version: "App version",
    session_label: "Signed in as",

    // ---- NETWORK ----
    offline_banner: "No connection. You can keep typing, but you will not be able to submit.",

    // ---- LANGUAGE ----
    language_english: "English",
    language_hindi: "हिंदी",
  },

  hi: {
    // ---- LOGIN ----
    app_name: "मेटल वर्कर",
    login_subtitle: "धातु डिस्पैच दर्ज करने के लिए लॉगिन करें",
    username: "उपयोगकर्ता नाम",
    password: "पासवर्ड",
    enter_username: "अपना उपयोगकर्ता नाम लिखें",
    enter_password: "अपना पासवर्ड लिखें",
    show_password: "पासवर्ड दिखाएँ",
    hide_password: "पासवर्ड छिपाएँ",
    login: "लॉगिन करें",
    logging_in: "लॉगिन हो रहा है…",
    wrong_credentials: "उपयोगकर्ता नाम या पासवर्ड मेल नहीं खाते।",
    enter_username_password: "जारी रखने के लिए उपयोगकर्ता नाम और पासवर्ड भरें।",
    login_failed: "लॉगिन नहीं हो सका",
    please_try_again: "कृपया पुनः प्रयास करें।",
    something_went_wrong: "कुछ गलत हो गया। कृपया पुनः प्रयास करें।",
    username_help: "आपका उपयोगकर्ता नाम आपके सुपरवाइज़र से मिलता है। यह आपका ईमेल पता नहीं है।",
    account_inactive: "आपका खाता निष्क्रिय कर दिया गया है। कृपया अपने सुपरवाइज़र से संपर्क करें।",
    account_not_set_up: "यह लॉगिन अभी ऐप के लिए तैयार नहीं है। कृपया अपने सुपरवाइज़र से संपर्क करें।",
    admin_login_unsupported: "यह ऐप मज़दूर और प्रोसेसर के लिए है। एडमिन वेब कंसोल का उपयोग करते हैं।",
    no_connection: "इंटरनेट कनेक्शन नहीं है। अपना नेटवर्क जाँचें और फिर कोशिश करें।",
    could_not_sign_in: "आपको साइन इन नहीं कर सके। कृपया फिर कोशिश करें।",

    // ---- SHARED / COMMON ----
    cancel: "रद्द करें",
    ok: "ठीक है",
    close: "बंद करें",
    retry: "फिर कोशिश करें",
    back: "वापस",
    loading: "लोड हो रहा है…",
    refresh: "रिफ्रेश",
    refreshing: "रिफ्रेश हो रहा है…",
    optional: "ज़रूरी नहीं",
    required_label: "ज़रूरी",
    search: "खोजें",
    clear_search: "खोज साफ़ करें",
    sign_in: "लॉगिन करें",

    // ---- DASHBOARD ----
    good_morning: "शुभ प्रभात",
    good_afternoon: "नमस्कार",
    good_evening: "शुभ संध्या",
    active_online: "काम के लिए तैयार",
    ready_to_log: "लोड दर्ज करने के लिए नया डिस्पैच दबाएँ।",
    quick_actions: "त्वरित कार्य",
    new_dispatch: "नया डिस्पैच",
    log_new_sale: "ट्रक लोड दर्ज करें",
    my_history: "मेरे डिस्पैच",
    view_past_logs: "अपने सभी रिकॉर्ड खोजें",
    scan_qr: "QR स्कैन",
    scan_truck_item: "ट्रक या आइटम स्कैन करें",
    profile: "प्रोफाइल",
    settings_info: "आपका खाता और भाषा",
    processor_note:
      "आप प्रोसेसर के रूप में साइन इन हैं। लोड की समीक्षा और स्वीकृति एडमिन कंसोल में होती है; ट्रक लोड दर्ज करना लेबर खातों द्वारा किया जाता है।",
    role_not_allowed_title: "आपकी भूमिका के लिए उपलब्ध नहीं",
    role_not_allowed_body:
      "केवल लेबर खाते ही डिस्पैच दर्ज कर सकते हैं। अपने डैशबोर्ड पर वापस जाएँ।",
    recent_activity: "हाल की गतिविधि",
    no_recent_dispatches: "अभी कोई डिस्पैच नहीं",
    submitted_logs_appear_here: "आपके दर्ज किए गए लोड यहाँ दिखाई देंगे।",
    logout: "लॉगआउट",
    logging_out: "लॉगआउट हो रहा है…",
    logout_failed: "लॉगआउट नहीं हो सका",
    unable_to_logout: "लॉगआउट नहीं हो सका। कृपया फिर कोशिश करें।",
    coming_soon: "जल्द आ रहा है",
    coming_soon_scan_qr: "अभी उपलब्ध नहीं है। तैयार होने पर आपके सुपरवाइज़र आपको बताएँगे।",
    today: "आज",
    yesterday: "कल",

    // ---- SUMMARY STRIP ----
    total_dispatches: "कुल",
    awaiting_review: "समीक्षा में",
    approved: "स्वीकृत",
    rejected: "अस्वीकृत",
    open_history: "सभी देखें",
    first_dispatch_hint: "अपना पहला डिस्पैच दर्ज करके शुरू करें।",

    // ---- DISPATCH FORM ----
    take_photo: "फोटो",
    retake_photo: "फोटो बदलें",
    choose_photo: "फोटो चुनें",
    vehicle_number: "वाहन नंबर",
    enter_vehicle_number: "जैसे DL 1L AB 1234",
    material_type: "सामग्री का प्रकार",
    select_material: "जो सामग्री लोड कर रहे हैं उसे चुनें",
    scrap_metal: "स्क्रेप",
    ferrous_metal: "लोहे की धातु",
    non_ferrous_metal: "गैर-लोहे की धातु",
    other: "अन्य",
    current_location: "वर्तमान स्थान",
    location_captured: "स्थान जोड़ा गया",
    getting_location: "आपका स्थान लिया जा रहा है…",
    location_unavailable: "स्थान उपलब्ध नहीं",
    date_time: "दिनांक और समय",
    auto_captured: "जमा करते समय अपने आप जुड़ जाएगा",
    review_dispatch: "अपनी जानकारी जाँचें",
    submit_dispatch: "डिस्पैच जमा करें",
    submitting: "जमा हो रहा है…",
    complete_required_fields: "सभी ज़रूरी जानकारी भरें",
    photo_required: "लोड की फोटो लें",
    vehicle_required: "वाहन नंबर लिखें",
    material_required: "सामग्री का प्रकार चुनें",
    camera_error: "कैमरा नहीं खुल सका",
    location_error: "स्थान नहीं मिल सका",
    uploading_photo: "फोटो अपलोड हो रही है…",
    saving_dispatch: "डिस्पैच सेव हो रहा है…",
    dispatch_submitted: "डिस्पैच जमा हो गया",
    your_dispatch_recorded: "आपका डिस्पैच दर्ज कर लिया गया है।",
    back_to_dashboard: "डैशबोर्ड पर वापस",
    recent_dispatches: "हाल के डिस्पैच",
    status_submitted: "जमा हुआ",
    status_reviewed: "समीक्षा में",
    status_approved: "स्वीकृत",
    status_rejected: "अस्वीकृत",
    failed_to_load_dispatches: "आपके डिस्पैच लोड नहीं हो सके",

    // ---- DISPATCH FORM: validation / permissions / errors ----
    fields_missing: "नीचे चिह्नित जानकारी भरें ({count})",
    field_photo: "फोटो",
    field_vehicle: "वाहन नंबर",
    field_material: "सामग्री का प्रकार",
    fix_fields_hint: "चिन्हित जानकारी भरना ज़रूरी है।",
    photo_upload_failed: "फोटो अपलोड नहीं हुई। आपकी जानकारी यहीं है — फिर कोशिश करें।",
    dispatch_save_failed: "डिस्पैच सेव नहीं हो सका। आपकी जानकारी यहीं है — फिर कोशिश करें।",
    check_internet: "अपना इंटरनेट कनेक्शन जाँचें और फिर कोशिश करें।",
    offline_cannot_submit: "आप ऑफ़लाइन हैं। जमा करने के लिए कनेक्शन दोबारा जोड़ें।",
    offline_cannot_upload: "आप ऑफ़लाइन हैं। फोटो अपलोड करने के लिए कनेक्शन दोबारा जोड़ें।",
    photo_hint_required: "ज़रूरी",
    camera_permission_title: "कैमरा अनुमति चाहिए",
    camera_permission_body: "लोड की फोटो लेने के लिए कैमरे की ज़रूरत है। आप इसे सेटिंग्स में चालू कर सकते हैं।",
    photo_permission_title: "फोटो अनुमति चाहिए",
    photo_permission_body: "लोड की तस्वीर जोड़ने के लिए फोटो की ज़रूरत है। आप इसे सेटिंग्स में चालू कर सकते हैं।",
    location_permission_title: "स्थान अनुमति चाहिए",
    location_permission_body: "हर डिस्पैच में यह दर्ज करने के लिए कि वह कहाँ हुआ, स्थान की ज़रूरत है। आप इसे सेटिंग्स में चालू कर सकते हैं।",
    open_settings: "सेटिंग्स खोलें",
    tap_to_edit: "बदलने के लिए दबाएँ",
    log_another: "एक और दर्ज करें",
    submitted_at_label: "जमा किया",

    // ---- UNSAVED CHANGES ----
    discard_title: "यह डिस्पैच छोड़ें?",
    discard_body: "आपकी फोटो और भरी हुई जानकारी सेव नहीं होगी।",
    keep_editing: "जारी रखें",
    discard: "छोड़ें",

    // ---- LOGOUT ----
    logout_confirm_title: "लॉगआउट करें?",
    logout_confirm_body: "दोबारा लॉगिन करने के लिए उपयोगकर्ता नाम और पासवर्ड चाहिए होंगे।",

    // ---- HISTORY ----
    history_title: "मेरे डिस्पैच",
    search_dispatches: "वाहन नंबर से खोजें",
    no_dispatches_yet: "आपने अभी तक कोई डिस्पैच दर्ज नहीं किया",
    no_dispatches_yet_body: "जमा करने पर डिस्पैच यहाँ दिखाई देगा।",
    no_matches: "आपकी खोज से कोई डिस्पैच नहीं मिला",
    no_matches_body: "वर्तनी जाँचें, या सब देखने के लिए खोज साफ़ करें।",
    filter_all: "सभी",
    load_more: "और लोड करें",
    showing_count: "{total} में से {shown} दिख रहे हैं",

    // ---- DISPATCH DETAIL ----
    dispatch_details: "डिस्पैच विवरण",
    photo_label: "फोटो",
    status_label: "स्थिति",
    location_label: "स्थान",
    not_recorded: "दर्ज नहीं",
    open_dispatch: "{vehicle} डिस्पैच खोलें",
    dispatch_not_found: "डिस्पैच नहीं मिला",
    dispatch_not_found_body: "यह हटा दिया गया हो सकता है। अपने डिस्पैच पर वापस जाएँ।",

    // ---- PROFILE ----
    profile_title: "प्रोफाइल",
    your_account: "आपका खाता",
    role_label: "भूमिका",
    role_worker: "मज़दूर",
    role_processor: "प्रोसेसर",
    language_label: "भाषा",
    app_version: "ऐप संस्करण",
    session_label: "लॉगिन",

    // ---- NETWORK ----
    offline_banner: "कनेक्शन नहीं है। आप लिखते रह सकते हैं, पर जमा नहीं कर पाएँगे।",

    // ---- LANGUAGE ----
    language_english: "English",
    language_hindi: "हिंदी",
  },
};

export function getTranslations(language: Language): TranslationDictionary {
  return translations[language] ?? translations.en;
}

/**
 * Fill `{placeholder}` tokens in a translated string.
 * `showing_count` -> "Showing 20 of 137"
 */
export function format(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : match,
  );
}

/** Time-of-day greeting key for the current clock. */
export function greetingKeyFor(date: Date): "good_morning" | "good_afternoon" | "good_evening" {
  const h = date.getHours();
  if (h < 12) return "good_morning";
  if (h < 17) return "good_afternoon";
  return "good_evening";
}
