# Page « Collectes de don du sang » – mode opératoire

Page web dynamique et auto-hébergée. On saisit un code postal, on règle le rayon, et la page interroge directement les API publiques pour mettre à jour les trois visuels :

1. **Prochaine collecte** : date, créneaux, lieu, places restantes, remplissage, liens de rendez-vous et d'itinéraire, et quatre indicateurs de synthèse.
2. **Agenda** : toutes les collectes de l'horizon, avec le statut de chacune (planning ouvert, complet, non ouvert).
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
- Changer le **type de don**, l'**horizon** ou l'option **collectes professionnelles** refiltre la réponse déjà reçue, sans nouvel appel.
- La page s'actualise seule toutes les heures tant qu'elle reste ouverte.

**Autres fonctions :**
- **Mémorisation dans l'adresse :** la recherche est conservée dans l'URL (`?cp=14760&r=15&don=plasma`). Une recherche se partage ou se met en favori.
- **Mode démonstration :** il rejoue une réponse enregistrée (code postal 14760), avec les dates recalées sur le jour courant. Il permet de présenter sans réseau ou si l'API est indisponible.
- **Panne de l'API :** les dernières données valides restent affichées et un bandeau explique l'erreur.

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

Le kit contourne le problème avec un petit **proxy nginx**. La page appelle `/api/efs/…` sur son propre serveur, et nginx relaie la requête à l'EFS. Ce relais met aussi les réponses en cache 5 minutes, ce qui ménage l'API.

La page essaie toujours le proxy en premier, puis l'appel direct en secours. C'est pourquoi l'**option B (Docker) est la solution de référence** : c'est la seule qui fournit le proxy.

---

## 2. Contenu du kit

```
efs-presentation/
├── site/                     ← le site (à publier tel quel)
│   ├── index.html
│   ├── css/styles.css
│   └── js/
│       ├── efs-core.js       logique métier (calculs, filtres)
│       ├── app.js            interface et appels API
│       └── demo-data.js      réponses enregistrées pour le mode démonstration
├── nginx.conf                serveur web + proxy API + en-têtes de sécurité
├── docker-compose.yml        déploiement Docker (option B)
├── Dockerfile                variante « image autonome »
├── tests/                    tests de la logique métier (Node.js)
└── MODE_OPERATOIRE.md
```

---

## 3. Choisir l'hébergement

| Situation | Option | Proxy API | Effort |
|---|---|---|---|
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

Sur le réseau local, rien d'autre n'est nécessaire. Pour une diffusion hors de chez vous, placez le conteneur derrière un reverse proxy HTTPS (Nginx Proxy Manager, Caddy, Traefik) plutôt que d'ouvrir le port 8080 sur la box. HTTPS active en plus le bouton « Utiliser ma position », que les navigateurs réservent aux pages sécurisées.

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

## 5. Tests

```bash
node --test tests/efs-core.test.js
```

Sept scénarios portent sur la réponse enregistrée : géométrie, critères de recette, horizon, collectes professionnelles, doublons, créneaux et heure d'hiver, places (ouvert, non ouvert, complet), bascule du type de don, prochaine collecte. Ils donnent les mêmes résultats que les tests de l'intégration Home Assistant.

## 6. Limites connues

- L'API Carto v3 est publique mais sans engagement de service : son format ou ses règles d'accès peuvent évoluer.
- La carte est un plan schématique à l'échelle (quadrillage en km), sans fond cartographique. Ce choix garde la page autonome. Chaque point ouvre le lieu sur OpenStreetMap.
- Les jeux de test reproduisent la structure décrite dans la spécification. Vérifiez la première réponse réelle (option B, commande `curl` ci-dessus) lors de la mise en service.
