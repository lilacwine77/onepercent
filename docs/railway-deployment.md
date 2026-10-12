# Déploiement Railway

Le site est servi à la racine d'un domaine Railway par Caddy. Le Dockerfile compile le frontend avec Node 22 et `npm ci`, puis copie uniquement `dist/` dans l'image de production Caddy. Aucun serveur Vite de développement ni runtime Node n'est nécessaire en production.

## Configuration du service

1. Connecter le dépôt GitHub `lilacwine77/onepercent` et choisir la branche contenant la version à publier.
2. Conserver la racine du dépôt comme répertoire source. Railway détecte automatiquement le `Dockerfile`.
3. Ne pas ajouter de commande Build ou Start : elles sont définies par le Dockerfile.
4. Définir le **Healthcheck Path** sur `/` dans les paramètres du service. Une réponse 200 vérifie la présence de la page compilée avant la bascule.
5. Générer un domaine public Railway. Caddy écoute sur le `PORT` injecté par Railway, avec `8080` comme valeur locale par défaut. Railway termine HTTPS en amont.

Aucun secret, volume ou base de données n'est requis par cette landing page. Les chemins `/assets/` et `/models/` restent inchangés. La navigation utilise des ancres ; les ressources inexistantes conservent une réponse 404 au lieu d'être remplacées par du HTML.

Configuration de production actualisée le 3 octobre 2026 : projet et service `onepercent`, environnement `production`, branche GitHub `main`. Le push sur cette branche déclenche automatiquement le build Railway. Le domaine public est [onepercent.fun](https://onepercent.fun/), redirigé vers [www.onepercent.fun](https://www.onepercent.fun/) en HTTPS. Le domaine technique [onepercent-production-83fa.up.railway.app](https://onepercent-production-83fa.up.railway.app/) reste disponible. Le healthcheck reste `/` ; aucun CLI Railway local n'est nécessaire pour cette route.

Le serveur active la compression gzip/zstd, conserve les requêtes de plage sur les modèles GLB et définit leurs types MIME explicitement. L'HTML est revalidé à chaque consultation ; les images, modèles et médias sous `/media/` peuvent être mis en cache pendant une heure. Le film MP4 est un fichier statique avec métadonnées en tête pour démarrer dès les premiers octets ; les requêtes de plage doivent également renvoyer 206 sur ce fichier. Le contexte Docker exclut les sources Blender, les captures de contrôle, le kit ZIP, l'historique Git et les configurations locales.

## Validation locale avec Docker

```sh
docker build -t onepercent-site .
docker run --rm -p 8080:8080 -e PORT=8080 onepercent-site
```

Ouvrir `http://localhost:8080/`. Vérifier la page, une image sous `/assets/` et `/models/onepercent-foil.glb`. Une requête `Range: bytes=0-15` sur le GLB doit renvoyer 206.

Contrôles effectués le 1er octobre 2026 : `npm run build` réussi ; configuration validée par Caddy 2.11.4 ; test HTTP du serveur natif avec `PORT=18743` réussi pour l'HTML, WebP, CSS compressé, type MIME GLB et réponse partielle 206 de 16 octets. Les ressources absentes et les fichiers source renvoient 404. Docker n'étant pas installé sur cette machine, la construction de l'image Linux doit être confirmée par le build Railway. Le compte rendu local est dans `artifacts/railway-check/report.json` (non versionné).

## Références

- [Dockerfiles sur Railway](https://docs.railway.com/builds/dockerfiles)
- [Healthchecks et variable PORT](https://docs.railway.com/deployments/healthchecks)
- [Domaines publics Railway](https://docs.railway.com/networking/public-networking)
- [Serveur de fichiers Caddy](https://caddyserver.com/docs/caddyfile/directives/file_server)

La documentation Railway consultée le 1er octobre 2026 indique que `railway.json` / `railway.toml` est déprécié pour les nouveaux services. Ce déploiement utilise donc le Dockerfile et les paramètres du service, sans ajouter de configuration héritée.
