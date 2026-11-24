// -----------------------------------------------------------------------------
// User-facing texts, in the four languages Gladys speaks: English (mandatory,
// the fallback of the core), French, German and Spanish.
//
// Every message the integration sends to a user (action results, connection
// status, widget labels and toasts) comes from here, so the four languages
// stay in sync: test/i18n.test.js checks that every entry carries all of them.
// -----------------------------------------------------------------------------

export const LANGUAGES = ['en', 'fr', 'de', 'es'];

export const MESSAGES = {
  // --- Connection status -----------------------------------------------------
  missing_credentials: {
    en: 'Enter your ChargePoint e-mail and password (or a session token).',
    fr: 'Saisissez votre e-mail et votre mot de passe ChargePoint (ou un jeton de session).',
    de: 'Geben Sie Ihre ChargePoint-E-Mail und Ihr Passwort (oder ein Sitzungstoken) ein.',
    es: 'Introduzca su correo y contraseña de ChargePoint (o un token de sesión).',
  },
  invalid_credentials: {
    en: 'ChargePoint refused the e-mail or the password.',
    fr: "ChargePoint a refusé l'e-mail ou le mot de passe.",
    de: 'ChargePoint hat die E-Mail oder das Passwort abgelehnt.',
    es: 'ChargePoint rechazó el correo o la contraseña.',
  },
  captcha_required: {
    en: 'ChargePoint asks for a captcha: paste the coulomb_sess cookie in the Session token field (see the documentation).',
    fr: 'ChargePoint demande un captcha : collez le cookie coulomb_sess dans le champ Jeton de session (voir la documentation).',
    de: 'ChargePoint verlangt ein Captcha: Fügen Sie das Cookie coulomb_sess in das Feld Sitzungstoken ein (siehe Dokumentation).',
    es: 'ChargePoint pide un captcha: pegue la cookie coulomb_sess en el campo Token de sesión (vea la documentación).',
  },
  session_expired: {
    en: 'The ChargePoint session expired: enter your password or a new session token.',
    fr: 'La session ChargePoint a expiré : saisissez votre mot de passe ou un nouveau jeton de session.',
    de: 'Die ChargePoint-Sitzung ist abgelaufen: Geben Sie Ihr Passwort oder ein neues Sitzungstoken ein.',
    es: 'La sesión de ChargePoint caducó: introduzca su contraseña o un nuevo token de sesión.',
  },
  unreachable: {
    en: 'ChargePoint cannot be reached right now, retrying.',
    fr: 'ChargePoint est injoignable pour le moment, nouvelle tentative en cours.',
    de: 'ChargePoint ist derzeit nicht erreichbar, neuer Versuch läuft.',
    es: 'ChargePoint no está disponible ahora mismo, reintentando.',
  },
  // --- Manifest actions ------------------------------------------------------
  connection_ok: {
    en: 'Connected as {username}: {chargers} home charger(s), {stations} public station(s).',
    fr: 'Connecté en tant que {username} : {chargers} borne(s) domestique(s), {stations} borne(s) publique(s).',
    de: 'Verbunden als {username}: {chargers} Heim-Ladestation(en), {stations} öffentliche Station(en).',
    es: 'Conectado como {username}: {chargers} cargador(es) doméstico(s), {stations} estación(es) pública(s).',
  },
  not_connected: {
    en: 'Not connected to ChargePoint yet: check the configuration.',
    fr: 'Pas encore connecté à ChargePoint : vérifiez la configuration.',
    de: 'Noch nicht mit ChargePoint verbunden: Prüfen Sie die Konfiguration.',
    es: 'Aún no conectado a ChargePoint: revise la configuración.',
  },
  not_a_home_charger: {
    en: 'Choose a ChargePoint home charger.',
    fr: 'Choisissez une borne domestique ChargePoint.',
    de: 'Wählen Sie eine ChargePoint-Heim-Ladestation.',
    es: 'Elija un cargador doméstico ChargePoint.',
  },
  charger_restarting: {
    en: 'The charger is restarting, it will be back in a few minutes.',
    fr: 'La borne redémarre, elle sera de retour dans quelques minutes.',
    de: 'Die Ladestation startet neu und ist in wenigen Minuten wieder da.',
    es: 'El cargador se está reiniciando, volverá en unos minutos.',
  },
  stations_found: {
    en: 'Stations nearby: {list}',
    fr: 'Bornes à proximité : {list}',
    de: 'Stationen in der Nähe: {list}',
    es: 'Estaciones cercanas: {list}',
  },
  no_station_found: {
    en: 'No station found in this area: widen the radius.',
    fr: 'Aucune borne trouvée dans cette zone : élargissez le rayon.',
    de: 'Keine Station in diesem Bereich gefunden: Vergrößern Sie den Radius.',
    es: 'No se encontró ninguna estación en esta zona: amplíe el radio.',
  },
  // --- Charging commands -----------------------------------------------------
  charging_started: {
    en: 'Charging started.',
    fr: 'Recharge démarrée.',
    de: 'Ladevorgang gestartet.',
    es: 'Carga iniciada.',
  },
  charging_stopped: {
    en: 'Charging stopped.',
    fr: 'Recharge arrêtée.',
    de: 'Ladevorgang beendet.',
    es: 'Carga detenida.',
  },
  start_requested: {
    en: 'Start requested, ChargePoint is confirming it.',
    fr: 'Démarrage demandé, ChargePoint le confirme.',
    de: 'Start angefordert, ChargePoint bestätigt ihn.',
    es: 'Inicio solicitado, ChargePoint lo está confirmando.',
  },
  stop_requested: {
    en: 'Stop requested, ChargePoint is confirming it.',
    fr: 'Arrêt demandé, ChargePoint le confirme.',
    de: 'Stopp angefordert, ChargePoint bestätigt ihn.',
    es: 'Parada solicitada, ChargePoint la está confirmando.',
  },
  not_plugged_in: {
    en: 'Plug the vehicle in before starting a charge.',
    fr: 'Branchez le véhicule avant de lancer une recharge.',
    de: 'Schließen Sie das Fahrzeug an, bevor Sie einen Ladevorgang starten.',
    es: 'Conecte el vehículo antes de iniciar una carga.',
  },
  no_active_session: {
    en: 'No charging session in progress.',
    fr: 'Aucune recharge en cours.',
    de: 'Kein Ladevorgang aktiv.',
    es: 'No hay ninguna carga en curso.',
  },
  // --- Widgets ---------------------------------------------------------------
  power: { en: 'Power', fr: 'Puissance', de: 'Leistung', es: 'Potencia' },
  energy: { en: 'Energy', fr: 'Énergie', de: 'Energie', es: 'Energía' },
  amperage_limit: {
    en: 'Current limit',
    fr: 'Limite de courant',
    de: 'Strombegrenzung',
    es: 'Límite de corriente',
  },
  balance: { en: 'Balance', fr: 'Solde', de: 'Guthaben', es: 'Saldo' },
  session_cost: {
    en: 'Session cost',
    fr: 'Coût de la session',
    de: 'Sitzungskosten',
    es: 'Coste de la sesión',
  },
  status: { en: 'Status', fr: 'État', de: 'Status', es: 'Estado' },
  cable: { en: 'Cable', fr: 'Câble', de: 'Kabel', es: 'Cable' },
  network: { en: 'Network', fr: 'Réseau', de: 'Netzwerk', es: 'Red' },
  schedule: {
    en: 'Charging schedule',
    fr: 'Programmation',
    de: 'Ladeplan',
    es: 'Programación',
  },
  duration: { en: 'Duration', fr: 'Durée', de: 'Dauer', es: 'Duración' },
  current_session: {
    en: 'Current session',
    fr: 'Session en cours',
    de: 'Aktuelle Sitzung',
    es: 'Sesión actual',
  },
  plugged_in: { en: 'Plugged in', fr: 'Branché', de: 'Eingesteckt', es: 'Conectado' },
  unplugged: { en: 'Unplugged', fr: 'Débranché', de: 'Ausgesteckt', es: 'Desconectado' },
  online: { en: 'Online', fr: 'En ligne', de: 'Online', es: 'En línea' },
  offline: { en: 'Offline', fr: 'Hors ligne', de: 'Offline', es: 'Sin conexión' },
  enabled: { en: 'Enabled', fr: 'Activée', de: 'Aktiv', es: 'Activada' },
  disabled: { en: 'Disabled', fr: 'Désactivée', de: 'Inaktiv', es: 'Desactivada' },
  none: { en: 'None', fr: 'Aucune', de: 'Keine', es: 'Ninguna' },
  start: { en: 'Start charging', fr: 'Lancer la charge', de: 'Laden starten', es: 'Iniciar carga' },
  stop: { en: 'Stop charging', fr: 'Arrêter la charge', de: 'Laden stoppen', es: 'Detener carga' },
  choose_charger: {
    en: 'Choose a home charger in the widget settings.',
    fr: 'Choisissez une borne domestique dans les réglages du widget.',
    de: 'Wählen Sie eine Heim-Ladestation in den Widget-Einstellungen.',
    es: 'Elija un cargador doméstico en los ajustes del widget.',
  },
  charger_unavailable: {
    en: 'This charger is not reported by ChargePoint right now.',
    fr: "Cette borne n'est pas remontée par ChargePoint pour le moment.",
    de: 'Diese Ladestation wird von ChargePoint derzeit nicht gemeldet.',
    es: 'ChargePoint no informa de este cargador en este momento.',
  },
  no_public_station: {
    en: 'No public station tracked: add their IDs in the configuration.',
    fr: 'Aucune borne publique suivie : ajoutez leurs identifiants dans la configuration.',
    de: 'Keine öffentliche Station verfolgt: Fügen Sie ihre IDs in der Konfiguration hinzu.',
    es: 'Ninguna estación pública seguida: añada sus identificadores en la configuración.',
  },
  ports_available: {
    en: '{available}/{total} available',
    fr: '{available}/{total} disponible(s)',
    de: '{available}/{total} frei',
    es: '{available}/{total} disponible(s)',
  },
  // --- Charger / connector states --------------------------------------------
  state_available: { en: 'Available', fr: 'Disponible', de: 'Verfügbar', es: 'Disponible' },
  state_occupied: { en: 'Occupied', fr: 'Occupée', de: 'Belegt', es: 'Ocupado' },
  state_reserved: { en: 'Reserved', fr: 'Réservée', de: 'Reserviert', es: 'Reservado' },
  state_unavailable: {
    en: 'Unavailable',
    fr: 'Indisponible',
    de: 'Nicht verfügbar',
    es: 'No disponible',
  },
  state_faulted: { en: 'Faulted', fr: 'En défaut', de: 'Gestört', es: 'Averiado' },
  state_charging: { en: 'Charging', fr: 'En charge', de: 'Lädt', es: 'Cargando' },
  state_ev_connected: {
    en: 'Vehicle connected',
    fr: 'Véhicule branché',
    de: 'Fahrzeug verbunden',
    es: 'Vehículo conectado',
  },
  state_paused_by_vehicle: {
    en: 'Paused by the vehicle',
    fr: 'En pause (véhicule)',
    de: 'Pausiert (Fahrzeug)',
    es: 'En pausa (vehículo)',
  },
  state_paused_by_charger: {
    en: 'Paused by the charger',
    fr: 'En pause (borne)',
    de: 'Pausiert (Ladestation)',
    es: 'En pausa (cargador)',
  },
  state_idle: { en: 'Idle', fr: 'Au repos', de: 'Leerlauf', es: 'En reposo' },
};

/**
 * Multi-language object of a message, with `{name}` placeholders replaced by
 * `vars` (the same values in every language).
 * @param {keyof MESSAGES} key
 * @param {Record<string, string | number>} [vars]
 */
export function t(key, vars = {}) {
  const message = MESSAGES[key];
  if (!message) {
    throw new Error(`Unknown message: ${key}`);
  }
  const result = {};
  for (const lang of LANGUAGES) {
    result[lang] = message[lang].replace(/\{(\w+)\}/g, (match, name) =>
      vars[name] === undefined ? match : String(vars[name]),
    );
  }
  return result;
}
