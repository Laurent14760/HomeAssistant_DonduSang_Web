<?php
/*
 * Relais minimal des deux API utilisées par la page (hébergement mutualisé Apache + PHP).
 * Équivalent de la section « proxy » de nginx.conf :
 *  - GET uniquement, vers deux adresses fixes (aucune URL libre : pas de relais ouvert) ;
 *  - seuls les paramètres attendus sont transmis, ni cookie ni adresse IP du visiteur ;
 *  - réponses mises en cache sur disque : 5 min (EFS), 1 jour (communes) ;
 *  - en cas de panne de l'API, la dernière réponse en cache est servie.
 * Nécessite PHP 7.4+ avec l'extension curl (ou allow_url_fopen).
 */
declare(strict_types=1);

const CIBLES = [
    'efs' => [
        'url' => 'https://oudonner.api.efs.sante.fr/carto-api/v3/samplingcollection/searchnearpoint',
        'chemin' => 'samplingcollection/searchnearpoint',
        'params' => ['CenterLatitude', 'CenterLongitude', 'DiameterLatitude', 'DiameterLongitude', 'UserLatitude', 'UserLongitude', 'Limit'],
        'ttl' => 300,
    ],
    'geo' => [
        'url' => 'https://geo.api.gouv.fr/communes',
        'chemin' => 'communes',
        'params' => ['codePostal', 'fields', 'format'],
        'ttl' => 86400,
    ],
];

function repondre(int $code, string $corps, string $cache = 'BYPASS'): void
{
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    header('X-Content-Type-Options: nosniff');
    header('Cache-Control: no-store');
    header('X-Cache: ' . $cache);
    echo $corps;
    exit;
}

function erreur(int $code, string $message): void
{
    repondre($code, json_encode(['erreur' => $message], JSON_UNESCAPED_UNICODE));
}

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'GET') {
    header('Allow: GET');
    erreur(405, 'Méthode non autorisée');
}
$cible = CIBLES[$_GET['cible'] ?? ''] ?? null;
if ($cible === null || ($_GET['chemin'] ?? '') !== $cible['chemin']) {
    erreur(404, 'Adresse inconnue');
}

// Paramètres attendus uniquement, valeurs courtes et sans caractère de contrôle.
$params = [];
foreach ($cible['params'] as $nom) {
    if (!isset($_GET[$nom])) continue;
    $v = (string) $_GET[$nom];
    if (strlen($v) > 64 || preg_match('/[\x00-\x1f]/', $v)) erreur(400, 'Paramètre invalide : ' . $nom);
    $params[$nom] = $v;
}
ksort($params);
$url = $cible['url'] . '?' . http_build_query($params);

$dossier = __DIR__ . '/cache';
if (!is_dir($dossier)) @mkdir($dossier, 0750, true);
$fichier = $dossier . '/' . sha1($url) . '.json';
$age = is_file($fichier) ? time() - (int) filemtime($fichier) : PHP_INT_MAX;
if ($age < $cible['ttl']) repondre(200, (string) file_get_contents($fichier), 'HIT');

function telecharger(string $url): ?string
{
    if (function_exists('curl_init')) {
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_FOLLOWLOCATION => false,
            CURLOPT_CONNECTTIMEOUT => 10,
            CURLOPT_TIMEOUT => 30,
            CURLOPT_HTTPHEADER => ['Accept: application/json', 'User-Agent: efs-collectes-web'],
        ]);
        $corps = curl_exec($ch);
        $code = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        curl_close($ch);
        return ($corps !== false && $code === 200) ? (string) $corps : null;
    }
    $ctx = stream_context_create(['http' => [
        'method' => 'GET', 'timeout' => 30, 'ignore_errors' => true,
        'header' => "Accept: application/json\r\nUser-Agent: efs-collectes-web\r\n",
    ]]);
    $corps = @file_get_contents($url, false, $ctx);
    $ok = isset($http_response_header[0]) && strpos($http_response_header[0], ' 200') !== false;
    return ($corps !== false && $ok) ? $corps : null;
}

$corps = telecharger($url);
if ($corps !== null && json_decode($corps) !== null) {
    @file_put_contents($fichier, $corps, LOCK_EX);
    repondre(200, $corps, 'MISS');
}
if (is_file($fichier)) repondre(200, (string) file_get_contents($fichier), 'STALE');
erreur(502, "L'API distante n'a pas répondu");
