# ChargePoint

Pilotez vos bornes domestiques ChargePoint (ChargePoint Home, Home Flex)
depuis Gladys, suivez vos sessions de recharge — à la maison comme sur le
réseau public — et surveillez la disponibilité des bornes publiques que vous
utilisez.

L'intégration dialogue avec le cloud ChargePoint, celui de l'application
mobile ChargePoint (c'est un portage JavaScript de la bibliothèque
[python-chargepoint](https://github.com/mbillow/python-chargepoint) utilisée
par l'intégration Home Assistant
[ha-chargepoint](https://github.com/mbillow/ha-chargepoint)). C'est une
intégration **cloud** : Gladys a besoin d'Internet et les bornes doivent être
en ligne.

> Cette intégration n'est pas affiliée à ChargePoint, Inc.

## Configuration

1. Ouvrez l'onglet **Configuration** de l'intégration.
2. Saisissez l'**e-mail** (ou l'identifiant) et le **mot de passe** de votre
   compte ChargePoint, puis enregistrez.
3. L'état en haut de la page passe au vert une fois connecté. Le bouton
   **Tester la connexion** indique combien de bornes domestiques et de bornes
   publiques ont été trouvées.
4. Ouvrez l'onglet **Découverte** et ajoutez les appareils voulus.

L'intégration maintient ensuite la session toute seule : ChargePoint la
renouvelle à chaque requête, et la dernière est conservée dans le volume
privé `/data` de l'intégration, si bien qu'un redémarrage ne refait pas de
connexion.

### Quand ChargePoint demande un captcha

ChargePoint protège sa page de connexion par une détection de robots
(Datadome). Quand elle bloque la connexion par mot de passe, l'état indique
_ChargePoint demande un captcha_. Utilisez alors la session de votre
navigateur :

1. Connectez-vous sur [chargepoint.com](https://www.chargepoint.com) depuis
   un navigateur d'ordinateur.
2. Ouvrez les outils de développement (F12) → **Application** (Chrome, Edge)
   ou **Stockage** (Firefox) → **Cookies** → `https://www.chargepoint.com`.
3. Copiez la valeur du cookie `coulomb_sess`.
4. Collez-la dans le champ **Jeton de session (coulomb_sess)** de la
   configuration et enregistrez.

Le jeton est un secret : Gladys ne le réaffiche jamais, et l'intégration ne
l'écrit jamais dans ses logs.

### Options

- **Intervalle de rafraîchissement** — fréquence de lecture de ChargePoint,
  en secondes : 3 minutes par défaut, 1 minute au minimum. Une commande
  déclenche une lecture supplémentaire quelques secondes plus tard.
- **Bornes publiques à suivre** — les identifiants de bornes publiques
  ChargePoint, séparés par des virgules. Pour les trouver, utilisez le bouton
  **Trouver des bornes à proximité** avec la latitude et la longitude d'un
  lieu : il liste les identifiants des bornes alentour.

## Appareils

### Borne domestique

Un appareil par borne domestique ChargePoint du compte, nommé d'après son
surnom dans l'application ChargePoint.

| Fonctionnalité         | Rôle                                                              |
| ---------------------- | ----------------------------------------------------------------- |
| Charging (recharge)    | Démarre (1) ou arrête (0) une session de recharge                 |
| Vehicle plugged in     | Le câble est-il branché sur un véhicule                           |
| Connector status       | Disponible, occupée, indisponible (borne hors ligne) ou en défaut |
| Charging state         | En charge, véhicule branché, en pause (véhicule ou borne)…        |
| Charging power         | Puissance délivrée par la session en cours (W)                    |
| Session energy         | Énergie de la session en cours ou de la dernière (kWh)            |
| Session cost           | Coût de la session en cours ou de la dernière                     |
| Session duration       | Durée de la session en cours ou de la dernière (minutes)          |
| Charging current limit | Courant de charge maximal (A), parmi les valeurs de la borne      |
| Charging schedule      | Active ou désactive la programmation de l'application ChargePoint |
| LED brightness         | Luminosité des LED de la borne (0 % = éteintes, par pas de 20 %)  |

Démarrer une session nécessite un véhicule branché. ChargePoint confirme les
démarrages et arrêts en une minute environ ; l'état suit à la lecture
suivante.

### Compte ChargePoint

Le solde du compte et la session en cours où qu'elle ait lieu, borne publique
comprise (recharge, puissance, énergie, coût).

### Borne publique

Un appareil par borne suivie : sa disponibilité (disponible dès qu'un point
de charge est libre) et le nombre de points libres.

Chaque appareil affiche un badge **cloud**, qui passe à _injoignable_ quand
ChargePoint ou la borne ne répond pas.

## Actions (écran Configuration)

- **Tester la connexion** — se connecte, lit tout et indique le compte et ce
  qui a été trouvé.
- **Redémarrer une borne domestique** — redémarre la borne choisie à distance
  (elle est hors ligne quelques minutes).
- **Trouver des bornes à proximité** — liste les identifiants des bornes
  publiques autour d'une latitude / longitude (rayon de 100 m à 5 km).

## Scènes

L'intégration ajoute ses propres cartes à l'éditeur de scènes (Gladys 5.1 ou
plus récent), dans la catégorie **Intégrations**.

Déclencheurs (laissez l'appareil vide pour tout accepter) :

- **Recharge démarrée** — une borne domestique, ou le compte (borne
  publique), commence à charger.
- **Recharge terminée** — une session se termine. Les actions suivantes
  peuvent lire `{{triggerEvent.data.energy_kwh}}`,
  `{{triggerEvent.data.cost}}` et `{{triggerEvent.data.duration_minutes}}`.
- **Véhicule branché** / **Véhicule débranché** — le câble d'une borne
  domestique.
- **Borne publique disponible** — une borne suivie n'avait aucun point libre
  et en a un (`{{triggerEvent.data.available_ports}}`).

Actions :

- **Lancer la recharge** — renvoie `started` : faux si aucun véhicule n'est
  branché, pour que les actions suivantes puissent réagir.
- **Arrêter la recharge** — sur une borne, ou toute session en cours si
  aucun appareil n'est choisi ; renvoie `stopped`.
- **Régler la limite de courant** — renvoie le courant réellement appliqué
  (la valeur acceptée la plus proche, jamais au-dessus de la demande).
- **Régler la programmation** — l'active (avec, au choix, de nouveaux
  horaires semaine / week-end, `HH:MM`) ou la désactive.
- **Redémarrer une borne**.

Exemple : _quand l'électricité est bon marché (déclencheur heures creuses),
lancer la recharge ; quand la recharge se termine, m'envoyer l'énergie et le
coût_.

## Tableau de bord

- **Borne ChargePoint** — choisissez une borne domestique dans les réglages
  du widget : puissance, énergie et limite de courant en direct, son état,
  câble, réseau, programmation, durée et coût de la session, et un bouton
  **Lancer la charge** / **Arrêter la charge**.
- **Compte ChargePoint** — solde, puissance en direct, session en cours,
  points libres des bornes suivies, et un bouton **Arrêter la charge**
  pendant une session.

## Dépannage

- **État « ChargePoint a refusé l'e-mail ou le mot de passe »** — vérifiez-les
  dans l'application ChargePoint ; l'e-mail est celui du compte.
- **État « ChargePoint demande un captcha »** — voir
  [plus haut](#quand-chargepoint-demande-un-captcha).
- **État « La session ChargePoint a expiré »** — saisissez votre mot de passe
  (l'intégration renouvelle ensuite la session seule) ou un nouveau jeton.
- **Une borne est _injoignable_** — la borne a perdu sa connexion Wi-Fi à
  ChargePoint ; vérifiez-la dans l'application ChargePoint.

Réglez `LOG_LEVEL=debug` pour obtenir le détail de chaque requête dans les
logs de l'intégration (interface Gladys, ou `docker logs`). Les jetons et
mots de passe ne sont jamais journalisés.
