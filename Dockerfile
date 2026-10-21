# Variante « image autonome » (alternative au montage de volumes du docker-compose)
# docker build -t efs-collectes:1.0 .
# docker run -d --name efs-collectes --restart unless-stopped -p 8080:80 efs-collectes:1.0
FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY site/ /usr/share/nginx/html/
