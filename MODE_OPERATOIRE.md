# Page « Collectes de don du sang » – mode opératoire

Page web dynamique et auto-hébergée (version 3.0). On saisit un code postal, on règle le rayon et le nombre de jours, et la page interroge directement les API publiques pour mettre à jour les trois visuels :

1. **Prochaine collecte** : date, créneaux, lieu, places restantes, remplissage, liens de rendez-vous et d'itinéraire, et quatre indicateurs de synthèse.
2. **Agenda** : toutes les collectes de la période, avec le statut de chacune (planning ouvert, complet, non ouvert).
3. **Carte et remplissage** : position des lieux dans le cercle, jauge de la prochaine collecte et taux de réservation collecte par collecte.

La page n'a **aucun lien avec Home Assistant**. Le serveur Home Assistant peut seulement servir à l'héberger (option A).

---

## 1. Fonctionnement

À chaque recherche, la page enchaîne trois traitements :

| Étape | Appel | Rôle |
|---|---|---|
| Code postal → commune(s) | `geo.api.gouv.fr/communes?codePostal=…` | Coordonnées du centre de la commune. Une liste de choix apparaît si le code postal couvre plusieurs communes. |
| Commune + rayon → collectes | `oudonner.api.efs.sante.fr/carto-api/v3/samplingcollection/searchnearpoint` | Lieux et collectes dans le rectangle qui englobe le cercle. |
| Filtrage dans le navigateur | `js/efs-core.js` | Mêmes règles que l'intégration Home Assistant (détail ci-dessous). |

Règles de filtrage appliquées :

- distance réelle calculée, et lieux hors du cercle écartés ;
- lieux au code postal incohérent avec leur position écartés ;
- doublons retirés ;
- collectes professionnelles masquées par défaut ;
- fuseau Europe/Paris ;
- compteurs nuls traités comme « planning non ouvert » et non comme « 0 place ».

**Ce qui déclenche un appel :**
- Changer le **rayon** relance un appel, car le rectangle interrogé change.
- Changer le **type de don**, le **nombre de jours** ou l'option **collectes professionnelles** refiltre la réponse déjà reçue, sans nouvel appel.
- La page s'actualise seule toutes les heures tant qu'elle reste ouverte.

**Autres fonctions :**
- **Mémorisation dans l'adresse :** la recherche est conservée dans l'URL (`?cp=14760&r=15&don=plasma`). Une recherche se partage ou se met en favori.
- **Mode démonstration :** il rejoue une réponse enregistrée (code postal 14760), avec les dates recalées sur le jour courant. Il permet de présenter sans réseau ou si l'API est indisponible.
- **Panne de l'API :** les dernières données valides restent affichées et un bandeau explique l'erreur.

### Nouveautés de la version 3.0

- **Mode tablette** (bouton « Mode tablette » en haut à droite, à côté de « ⚙ Réglages », ou adresse `…/?mode=tablette` ; « Page complète » ramène à la page normale). Affichage lisible de loin du **lieu de collecte choisi** : date, horaires, places restantes, jauge, bouton de rendez-vous, puis les autres collectes du secteur, l'heure et la mise à jour. Voir § 7.
- **Réglages par bouton.** « ⚙ Réglages » ouvre une fenêtre avec le lieu initial (code postal, commune), le rayon, le nombre de jours, le type de don et le lieu de collecte affiché ; la liste des lieux se recalcule à chaque changement. « Enregistrer » les conserve dans le cookie `efs_tablette` (un an) ; la case « Ouvrir directement en mode tablette » fait démarrer la page en mode tablette sur cet appareil. « Oublier ces réglages » efface le cookie.
- **Bouton « Prendre rendez-vous » toujours présent** sur la prochaine collecte (page et tablette) : lien direct quand le planning est ouvert, sinon page de réservation du site de l'EFS, avec une explication (planning non ouvert, collecte complète).
- **Rayon 0 = uniquement la commune du code postal**, comme l'intégration Home Assistant 1.4.1 : la page interroge l'API à 10 km puis ne garde que les collectes de la commune. Le rayon 0 n'est pas proposé avec « Utiliser ma position » (pas de commune de référence).
- **Nombre de jours** de 1 à 180 (champ libre, défaut 30) au lieu de l'ancienne liste 30/60/90/180. Une valeur hors bornes, ou un rayon hors 0–50 km dans les réglages, est signalée sous le champ et la recherche n'est pas lancée.
- **Hébergement mutualisé** : relais PHP (`site/api/proxy.php`) et en-têtes de sécurité (`site/.htaccess`) pour publier la page sur un petit site web Apache + PHP, avec le même cache que nginx. Voir l'option D.

Cookies : `efs_lieu_base` (lieu de base, page normale) et `efs_tablette` (réglages de la tablette) sont indépendants, déposés uniquement quand l'utilisateur clique, lus par ce seul navigateur et jamais transmis à un tiers.

### Nouveautés de la version 2.2

- **Lieu de base.** Le bouton « Définir … comme lieu de base » (sous le formulaire) enregistre le lieu affiché. À la prochaine ouverture sans paramètre dans l’adresse, la page s’ouvre directement sur ce lieu ; « Revenir au lieu de base » y ramène après une autre recherche, « Remplacer par … » le change, « Oublier » l’efface. Fonctionne avec un code postal comme avec « Utiliser ma position ».
- **Cookie, à la demande.** Case « Mémoriser sur cet appareil » cochée : cookie `efs_lieu_base` valable un an. Décochée : cookie de session, effacé à la fermeture du navigateur. Le cookie ne contient que le lieu (code postal, commune, coordonnées), n’est lu que par la page et n’est jamais transmis à un tiers ; il est déposé uniquement quand l’utilisateur clique, ce qui le dispense de bandeau de consentement (cookie fonctionnel demandé par l’utilisateur). Il est posé avec `SameSite=Lax` et `Secure` lorsque la page est servie en HTTPS.
- **Priorité à l’ouverture.** Paramètres de l’adresse (lien partagé, favori) → lieu de base → 14760 par défaut.
- **Collecte présentée.** Au-dessus du visuel 1, la liste « Collecte présentée » propose les communes des collectes à venir avec leurs dates : la synthèse affiche alors la prochaine collecte de cette commune (par défaut, la plus proche dans le temps). Si la commune n’a plus de collecte retenue, la page l’indique et revient à la prochaine collecte. Le choix est conservé dans l’adresse (`vc=`).
- **Rendez-vous ouverts seulement.** Nouvelle case du formulaire : les trois visuels ne gardent que les collectes où l’on peut réserver (`rdv=1` dans l’adresse).
- **Liens de rendez-vous** complétés en `https://` (l’API les fournit sans), **noms de communes** écrits selon l’usage (« BRETTEVILLE L ORGUEILLEUSE » → « Bretteville-l’Orgueilleuse »), **icône** goutte de sang dans l’onglet du navigateur.

Le cookie n’est pas disponible quand la page est ouverte par double-clic sur le fichier (adresse `file://`) : la page le signale et garde le lieu de base jusqu’à sa fermeture. Servie par l’option A, B ou C (adresse `http://` ou `https://`), la page n’a pas cette limite.

### Point clé : le proxy

Un navigateur n'accepte d'appeler une API d'un autre domaine que si celle-ci l'autorise (règle CORS) :
- l'API Géo l'autorise ;
- pour l'API de l'EFS, rien ne le garantit.

Le kit contourne le problème avec un petit **relais** : la page appelle `api/efs/…` sur son propre serveur, qui relaie la requête à l'EFS et met les réponses en cache 5 minutes, ce qui ménage l'API. Deux relais sont fournis : **nginx** (option B, Docker) et **PHP** (option D, hébergement mutualisé).

La page essaie toujours le relais en premier, puis l'appel direct en secours. C'est pourquoi les **options B et D sont les solutions de référence** ; les options A et C n'ont pas de relais.

---

## 2. Contenu du kit

```
efs-presentation/
├── site/                     ← le site (à publier tel quel)
│   ├── index.html
│   ├── .htaccess             en-têtes de sécurité (hébergement Apache, option D)
│   ├── api/                  relais PHP des API (option D) : proxy.php, .htaccess
│   ├── css/styles.css
│   └── js/
│       ├── efs-core.js       logique métier (calculs, filtres)
│       ├── app.js            interface et appels API
│       └── demo-data.js      réponses enregistrées pour le mode démonstration
├── nginx.conf                serveur web + proxy API + en-têtes de sécurité
├── docker-compose.yml        déploiement Docker (option B)
├── Dockerfile                variante « image autonome »
├── images/                   captures d'écran du README
├── tests/                    tests de la logique métier (Node.js)
└── MODE_OPERATOIRE.md
```

---

## 3. Choisir l'hébergement

| Situation | Option | Proxy API | Effort |
|---|---|---|---|
| Petit site web chez un hébergeur mutualisé (Apache + PHP), accessible depuis Internet | **D – hébergement mutualisé** | Oui (PHP) | 20 min |
| Machine avec Docker : NAS, serveur Linux, PC, ou hôte Home Assistant *Container* ou *Supervised* | **B – Docker (recommandée)** | Oui | 15 min |
| Seul le serveur Home Assistant OS est disponible | **A – dossier `www` de Home Assistant** | Non | 5 min |
| Démonstration sur un portable | **C – serveur local temporaire** | Non | 2 min |

**Pourquoi pas Docker sur Home Assistant OS ?** HA OS n'exécute que des modules complémentaires. Lancer un conteneur libre impose de désactiver le mode protégé (par exemple avec l'add-on Portainer), ce qui classe l'installation « non prise en charge ». C'est déconseillé sur la machine qui pilote la maison.

---

## Option B – Docker (recommandée)

### Prérequis

- **Linux (Debian, Ubuntu, Raspberry Pi OS) :**
  ```bash
  curl -fsSL https://get.docker.com | sh
  sudo usermod -aG docker $USER      # se déconnecter puis se reconnecter
  docker compose version
  ```
- **Windows ou macOS :** Docker Desktop.
- **Synology :** *Container Manager* → Projet → Créer, en pointant le dossier du kit.
- **QNAP :** *Container Station* → Applications → Créer, en collant le `docker-compose.yml`.

Le serveur doit pouvoir joindre Internet en HTTPS sortant (port 443).

### Déploiement

```bash
# copier le dossier efs-presentation sur le serveur, par exemple dans /opt
cd /opt/efs-presentation
docker compose up -d
docker compose ps                               # état « running », puis « healthy »
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8080/                       # 200
curl -s "http://localhost:8080/api/geo/communes?codePostal=14760&fields=nom" | head -c 200
curl -s "http://localhost:8080/api/efs/samplingcollection/searchnearpoint?CenterLatitude=49.1665&CenterLongitude=-0.4185&DiameterLatitude=0.18&DiameterLongitude=0.28&UserLatitude=49.1665&UserLongitude=-0.4185&Limit=5" | head -c 300
```

Les deux dernières commandes doivent renvoyer du JSON. La page est alors disponible sur `http://<ip-du-serveur>:8080`.

### Sécurité intégrée

- Le conteneur tourne en lecture seule, avec un site monté en lecture seule et un redémarrage automatique.
- Le proxy n'accepte que des requêtes `GET`, uniquement vers les deux API prévues. Il ne transmet ni cookies ni adresse IP du visiteur.
- Une politique de sécurité de contenu (CSP) interdit tout script ou appel réseau autre que ceux de la page et des deux API.

### Exploitation

| Action | Commande |
|---|---|
| Mettre à jour le site | Remplacer les fichiers de `site/` : effet immédiat |
| Modifier `nginx.conf` | `docker compose restart` |
| Changer de port | Modifier `"8080:80"`, puis `docker compose up -d` |
| Consulter les journaux | `docker compose logs -f` |
| Mettre à jour nginx | `docker compose pull && docker compose up -d` |
| Arrêter | `docker compose down` |

### Si nginx ne démarre pas

nginx résout les noms `oudonner.api.efs.sante.fr` et `geo.api.gouv.fr` au démarrage. Si le serveur n'a pas encore de DNS à ce moment (coupure Internet au boot), le conteneur redémarre en boucle jusqu'au retour du réseau. `docker compose logs` affiche alors `host not found in upstream`.

### Accès extérieur (facultatif)

Sur le réseau local, rien d'autre n'est nécessaire. Pour une diffusion hors de chez vous, placez le conteneur derrière un reverse proxy HTTPS (Nginx Proxy Manager, Caddy, Traefik) plutôt que d'ouvrir le port 8080 sur la box. HTTPS active en plus le bouton « Utiliser ma position », que les navigateurs réservent aux pages sécurisées, et l'attribut `Secure` des cookies.

Exemple sur un petit VPS avec Caddy (certificat Let's Encrypt automatique) : faire pointer un enregistrement DNS `collectes.mondomaine.fr` vers le VPS, ouvrir les ports 80 et 443, puis dans le `Caddyfile` :

```
collectes.mondomaine.fr {
    reverse_proxy 127.0.0.1:8080
}
```

Avec Nginx Proxy Manager : *Proxy Hosts → Add Proxy Host*, domaine `collectes.mondomaine.fr`, cible `http://<ip-du-serveur>:8080`, onglet *SSL* → *Request a new SSL Certificate* et *Force SSL*.

---

## Option A – Héberger dans Home Assistant (sans proxy)

1. Installer le module complémentaire *File editor* : Paramètres → Modules complémentaires → Boutique. *Samba share* convient aussi.
2. Créer le dossier `/config/www/efs/`, puis y copier **tout le contenu** de `site/`. L'arborescence doit être conservée : `index.html`, `css/`, `js/`.
3. Redémarrer Home Assistant, uniquement si le dossier `www` vient d'être créé.
4. Ouvrir `http://<ip-ha>:8123/local/efs/index.html`. Pour l'ajouter au menu latéral : Paramètres → Tableaux de bord → Ajouter → *Page Web*.

**Limites de cette option :**
- **Pas de proxy.** Le navigateur appelle l'API de l'EFS en direct. Si l'EFS n'autorise pas ces appels (CORS), un bandeau rouge l'indique et propose le mode démonstration. Faites l'essai : si le bandeau apparaît, passez à l'option B.
- **Accès public.** Les fichiers de `/local/` sont servis sans authentification à quiconque peut joindre le port 8123.
- **Cache du navigateur.** Après une mise à jour des fichiers, forcez le rechargement (Ctrl + F5).

## Option D – Petit site web sur un hébergement mutualisé (Apache + PHP)

Pour publier la page sur Internet sans serveur à administrer : un hébergement web d'entrée de gamme (OVH Perso/Pro, o2switch, Ionos, Hostinger, PlanetHoster…) suffit. Le relais PHP fourni remplace le proxy nginx : la page appelle `api/efs/…` et `api/geo/…`, et `site/api/proxy.php` relaie vers les deux API, et elles seules.

### Prérequis

- Hébergement **Apache** avec `.htaccess` actif (`mod_rewrite`, `mod_headers`) — c'est le cas par défaut chez les hébergeurs cités.
- **PHP 7.4 ou plus** (8.x conseillé) avec l'extension `curl` (ou `allow_url_fopen` activé).
- Un nom de domaine ou sous-domaine (ex. `collectes.mondomaine.fr`) et un certificat **HTTPS** (Let's Encrypt, gratuit, activable depuis l'espace client de l'hébergeur).
- Un client FTP/SFTP (FileZilla, WinSCP) ou le gestionnaire de fichiers de l'espace client.

### Mise en ligne

1. **Sous-domaine** (facultatif) : dans l'espace client, créer `collectes.mondomaine.fr` et le faire pointer vers un dossier, par exemple `www/collectes/`. Sans sous-domaine, un dossier `www/collectes/` donnera `https://mondomaine.fr/collectes/`.
2. **HTTPS** : activer le certificat Let's Encrypt pour ce domaine et, si l'option existe, la redirection automatique HTTP → HTTPS.
3. **PHP** : vérifier dans l'espace client que la version de PHP est 7.4 ou plus (8.2 recommandé).
4. **Fichiers** : déposer **tout le contenu** du dossier `site/` dans le dossier cible, en conservant l'arborescence et les fichiers cachés :

   ```
   www/collectes/
   ├── .htaccess          ← fichier caché : activer l'affichage des fichiers cachés dans le client FTP
   ├── index.html
   ├── api/
   │   ├── .htaccess
   │   └── proxy.php
   ├── css/styles.css
   └── js/ (app.js, efs-core.js, demo-data.js)
   ```

   Le dossier `api/cache/` est créé automatiquement au premier appel ; s'il ne peut pas l'être, le créer à la main avec les droits d'écriture du serveur web (755 ou 775 selon l'hébergeur).
5. **Vérifier le relais** dans un navigateur :
   - `https://collectes.mondomaine.fr/api/geo/communes?codePostal=14760&fields=nom` → `[{"nom":"Bretteville-sur-Odon"}]` ;
   - `https://collectes.mondomaine.fr/api/efs/samplingcollection/searchnearpoint?CenterLatitude=49.1665&CenterLongitude=-0.4185&DiameterLatitude=0.18&DiameterLongitude=0.28&UserLatitude=49.1665&UserLongitude=-0.4185&Limit=5` → du JSON commençant par `{"samplingLocationCollections"`.
6. **Ouvrir la page** : `https://collectes.mondomaine.fr/`. Le bandeau d'état doit indiquer « Données EFS de hh:mm », sans bandeau rouge.

### Sécurité et fonctionnement du relais

- `GET` uniquement, vers deux adresses fixes : ce n'est pas un relais ouvert (toute autre adresse répond 404) ; seuls les paramètres attendus sont transmis, ni cookie ni adresse IP du visiteur.
- Cache disque dans `api/cache/` : 5 min pour l'EFS, 1 jour pour les communes ; en cas de panne de l'API, la dernière réponse connue est servie (en-tête `X-Cache: STALE`). Le dossier n'est pas accessible depuis le web.
- `site/.htaccess` pose les mêmes en-têtes de sécurité que nginx (CSP, `nosniff`, `no-referrer`).

### Dépannage

| Symptôme | Cause et solution |
|---|---|
| `api/geo/…` renvoie une page 404 de l'hébergeur | `.htaccess` absent (fichier caché non transféré) ou `mod_rewrite` désactivé : retransférer `api/.htaccess`, vérifier l'option dans l'espace client. |
| Erreur 500 | Directive non autorisée par l'hébergeur dans `.htaccess` : commenter les lignes `Options` ou `Header` concernées (journal d'erreurs de l'espace client). |
| `{"erreur":"L'API distante n'a pas répondu"}` (502) | Appels sortants bloqués ou `curl` absent : vérifier l'extension `curl` dans la configuration PHP ; certains hébergements gratuits interdisent les appels sortants. |
| La page ne se met pas à jour après un nouvel envoi | Cache du navigateur : Ctrl + F5 (les fichiers sont servis avec `Cache-Control: no-cache`). |

Mise à jour : retransférer le contenu de `site/` (le cache `api/cache/` peut être conservé ou supprimé).

### Exemple : Scaleway Web Hosting (cPanel), sous-domaine `dondusang`

Remplacer `mondomaine.fr` par le domaine rattaché à l'hébergement.

1. **Sous-domaine** : console Scaleway → *Domains & Web Hosting* → *Web Hosting* → l'hébergement → ouvrir **cPanel**. Dans cPanel → **Domaines** → **Créer un nouveau domaine** : `dondusang.mondomaine.fr`, **décocher** « Partager la racine du document », racine proposée `dondusang.mondomaine.fr` (ou `public_html/dondusang`) → **Soumettre**.
2. **DNS** :
   - domaine utilisant les serveurs DNS Scaleway de l'hébergement (configuration automatique) : l'enregistrement du sous-domaine est créé avec lui ;
   - domaine géré ailleurs, ou zone gérée dans *Domains and DNS* (configuration manuelle) : ajouter un enregistrement `dondusang` de type **A** vers l'adresse IPv4 de l'hébergement (cPanel → panneau *Informations générales* → *Adresse IP partagée*), plus un **AAAA** si une IPv6 est indiquée. Un **CNAME** `dondusang` → `mondomaine.fr.` (point final) convient aussi si `mondomaine.fr` pointe déjà vers l'hébergement.
   - contrôle : `dig +short dondusang.mondomaine.fr` renvoie l'adresse de l'hébergement (quelques minutes, jusqu'à 48 h pour un changement de serveurs DNS).
3. **HTTPS** : le certificat Let's Encrypt est émis automatiquement (AutoSSL) une fois le DNS résolu. cPanel → **État SSL/TLS** : le sous-domaine doit être couvert ; sinon **Exécuter AutoSSL**. Puis cPanel → **Domaines** → activer **Forcer la redirection HTTPS** pour `dondusang.mondomaine.fr` (ou décommenter le bloc prévu dans `site/.htaccess`).
4. **PHP** : cPanel → **MultiPHP Manager** → `dondusang.mondomaine.fr` → PHP 8.2 ou plus. Si cPanel propose **Select PHP Version**, vérifier que l'extension `curl` est cochée.
5. **Fichiers** : zipper le **contenu** du dossier `site/` (pas le dossier lui-même), puis cPanel → **Gestionnaire de fichiers** → racine du sous-domaine → *Charger* → clic droit sur le zip → *Extract*. Dans *Paramètres* du gestionnaire, cocher **Afficher les fichiers cachés** pour vérifier la présence de `.htaccess` et `api/.htaccess`. (Alternative : SFTP/FTP avec les identifiants cPanel.)
6. **Vérifier les redirections** :

   ```bash
   curl -sI http://dondusang.mondomaine.fr/ | head -3                         # 301 vers https://
   curl -s "https://dondusang.mondomaine.fr/api/geo/communes?codePostal=14760&fields=nom"   # [{"nom":"Bretteville-sur-Odon"}]
   curl -s "https://dondusang.mondomaine.fr/api/efs/samplingcollection/searchnearpoint?CenterLatitude=49.1665&CenterLongitude=-0.4185&DiameterLatitude=0.18&DiameterLongitude=0.28&UserLatitude=49.1665&UserLongitude=-0.4185&Limit=5" | head -c 120
   curl -s -o /dev/null -w "%{http_code}\n" https://dondusang.mondomaine.fr/api/autre      # 404 (relais fermé)
   curl -s -o /dev/null -w "%{http_code}\n" https://dondusang.mondomaine.fr/api/cache/     # 404 (cache non exposé)
   ```

7. **Ouvrir** `https://dondusang.mondomaine.fr/` puis, sur la tablette, `https://dondusang.mondomaine.fr/?mode=tablette`.

## Option C – Démonstration sur un portable

Depuis le dossier `site/` :

```bash
python3 -m http.server 8080
```

Ouvrez ensuite `http://localhost:8080`. Sans proxy, le comportement est le même qu'en option A. Le mode démonstration fonctionne dans tous les cas, même hors ligne.

Ouvrir directement `index.html` par double-clic fonctionne généralement aussi, dans les mêmes conditions (sans proxy). Le serveur local reste plus fiable, certains navigateurs restreignant les pages ouvertes depuis le disque.

---

## 4. Vérification avant présentation

- [ ] Recherche **14760, 10 km** : Bretteville-sur-Odon est trouvée, et les collectes des communes voisines apparaissent, triées par date.
- [ ] Le bandeau d'état indique « Données EFS de hh:mm », sans bandeau rouge.
- [ ] Rayon passé à 20 km : de nouveaux lieux apparaissent sur la carte, et le quadrillage s'adapte.
- [ ] Type de don « Plasma » : les compteurs changent sans nouvelle recherche.
- [ ] Un code postal couvrant plusieurs communes (cas fréquent en zone rurale) fait apparaître la liste des communes.
- [ ] Une collecte au planning fermé affiche « Planning non ouvert », jamais « 0 place ».
- [ ] Le bouton « Données de démonstration » fonctionne (solution de secours en cas de coupure).
- [ ] « Définir … comme lieu de base », puis rechargement de la page sans paramètre : la page s’ouvre sur ce lieu ; « Oublier » l’efface.
- [ ] « Collecte présentée » : choisir une commune affiche sa prochaine collecte dans le visuel 1.
- [ ] L'affichage est correct sur téléphone et en mode sombre.
- [ ] Rayon 0 avec 14760 : seules les collectes de Bretteville-sur-Odon restent ; le bandeau indique « Bretteville-sur-Odon seulement ».
- [ ] Nombre de jours 200 : message sous le champ, aucune nouvelle recherche.
- [ ] « Mode tablette » : la fenêtre de réglages s'ouvre ; choisir un lieu, « Enregistrer » ; recharger la page sans paramètre : elle s'ouvre en mode tablette sur ce lieu. « Page complète » revient à la page normale ; « Mode tablette » (en haut à droite) y retourne.
- [ ] « Prendre rendez-vous » : collecte au planning ouvert → lien direct de la collecte ; collecte complète ou planning non ouvert → page de réservation du site de l'EFS, avec une phrase d'explication sous le bouton.
- [ ] Option D : les deux adresses de vérification du relais renvoient du JSON.

## 5. Tests

```bash
node --test tests/efs-core.test.js
```

Neuf scénarios portent sur la réponse enregistrée : géométrie, critères de recette, horizon, collectes professionnelles, doublons, créneaux et heure d'hiver, places (ouvert, non ouvert, complet), bascule du type de don, prochaine collecte, rayon 0 (commune seule). Ils donnent les mêmes résultats que les tests de l'intégration Home Assistant.

## 6. Limites connues

- L'API Carto v3 est publique mais sans engagement de service : son format ou ses règles d'accès peuvent évoluer.
- La carte est un plan schématique à l'échelle (quadrillage en km), sans fond cartographique. Ce choix garde la page autonome. Chaque point ouvre le lieu sur OpenStreetMap.
- Les jeux de test reproduisent la structure décrite dans la spécification. Vérifiez la première réponse réelle (option B, commande `curl` ci-dessus) lors de la mise en service.

## 7. Mettre en place une tablette

1. Sur la tablette, ouvrir la page publiée (option B ou D, de préférence en HTTPS), puis toucher **Mode tablette** — ou ouvrir directement `https://collectes.mondomaine.fr/?mode=tablette` et l'enregistrer en favori.
2. La fenêtre **Réglages de la tablette** s'ouvre au premier usage. Exemple : code postal `14760`, rayon `10`, nombre de jours `30`, type « Sang total », lieu de collecte « Salle polyvalente · Bretteville-sur-Odon ». Si le lieu voulu n'apparaît pas, augmenter le nombre de jours : la liste se recalcule aussitôt.
3. Laisser cochée **Ouvrir directement en mode tablette sur cet appareil**, puis **Enregistrer**. Les réglages sont conservés un an dans le cookie `efs_tablette` de ce navigateur.
4. Pour modifier le lieu initial, le rayon ou le nombre de jours : bouton **⚙ Réglages** en haut à droite. **Page complète** revient à la page normale pour la visite en cours, sans effacer les réglages ; sur la page normale, les boutons **⚙ Réglages** et **Mode tablette**, côte à côte en haut à droite, permettent de régler la tablette et d'y revenir en un clic. « Oublier ces réglages » efface le cookie.
5. **Prendre rendez-vous** : le bouton de la prochaine collecte ouvre le site de l'EFS dans un nouvel onglet. Planning ouvert : lien direct vers la collecte affichée, pour bloquer un créneau. Planning non encore ouvert ou collecte complète : page de réservation de l'EFS (« Trouver une collecte »), avec une phrase qui l'explique sous le bouton.
6. Affichage permanent (facultatif) :
   - Android : ajouter la page à l'écran d'accueil (menu ⋮ → *Ajouter à l'écran d'accueil*), ou utiliser une application kiosque (*Fully Kiosk Browser*) avec l'adresse `…/?mode=tablette` et l'écran toujours allumé ;
   - iPad : Safari → Partager → *Sur l'écran d'accueil*, et *Accès guidé* (Réglages → Accessibilité) pour verrouiller l'écran sur la page.

Le cookie est propre au navigateur : une application kiosque garde le sien, distinct de celui de Chrome ou Safari ; refaire les réglages dans le navigateur réellement utilisé. Si le lieu choisi n'a plus de collecte dans la période, la tablette l'indique et affiche la prochaine collecte du secteur.

