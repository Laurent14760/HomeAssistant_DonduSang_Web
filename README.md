# Collectes de don du sang – page web

Page web autonome qui affiche les prochaines collectes de l’Établissement français du sang autour d’un code postal ou de votre position : prochaine collecte, agenda, carte et remplissage des créneaux. Elle interroge directement les API publiques (API Carto v3 de l’EFS, API Géo de l’État) ; aucune base de données, aucun lien avec Home Assistant.

Version 2.2 · compagnon de l’intégration [HomeAssistant_DonduSang](https://github.com/Laurent14760/HomeAssistant_DonduSang).

## Démarrage rapide (Docker)

```bash
git clone https://github.com/Laurent14760/HomeAssistant_DonduSang_Web.git
cd HomeAssistant_DonduSang_Web
docker compose up -d
```

Puis ouvrir `http://<ip-du-serveur>:8080`. Le conteneur nginx sert la page et relaie les appels aux API (indispensable pour l’API de l’EFS, qui peut refuser les appels directs du navigateur).

Autres hébergements (dossier `www` de Home Assistant, serveur local) et vérifications : voir [MODE_OPERATOIRE.md](MODE_OPERATOIRE.md).

## Fonctionnalités

- Recherche par code postal (choix de la commune si plusieurs) ou par géolocalisation, rayon de 1 à 50 km.
- Type de don (sang, plasma, plaquettes), horizon, collectes professionnelles, filtre « rendez-vous ouverts ».
- Lieu de base mémorisé à la demande dans un cookie (`efs_lieu_base`, un an ou session).
- Choix de la collecte présentée par commune ; recherche conservée dans l’adresse (lien partageable).
- Mode démonstration hors ligne, thème clair et sombre, affichage mobile.

## Contenu

| Chemin | Rôle |
|---|---|
| `site/` | La page (HTML, CSS, JavaScript sans dépendance) |
| `nginx.conf`, `docker-compose.yml`, `Dockerfile` | Hébergement et proxy des API |
| `tests/` | Tests de la logique métier : `node --test tests/efs-core.test.js` |
| `MODE_OPERATOIRE.md` | Installation, exploitation, dépannage |

Page indépendante, non affiliée à l’EFS.
