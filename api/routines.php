<?php
declare(strict_types=1);
header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Headers: Content-Type, Authorization');
header('Access-Control-Allow-Methods: GET, POST, PATCH, DELETE, OPTIONS');
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }
$config = require __DIR__ . '/config.php';
$token = preg_replace('/^Bearer\s+/i', '', $_SERVER['HTTP_AUTHORIZATION'] ?? '');
if (!$token) { http_response_code(401); echo json_encode(['error' => 'Sessão obrigatória']); exit; }
$method = $_SERVER['REQUEST_METHOD'];
$id = isset($_GET['id']) ? rawurlencode((string) $_GET['id']) : null;
$endpoint = rtrim($config['supabase_url'], '/') . '/rest/v1/medication_routines' . ($id ? '?id=eq.' . $id : '');
$body = file_get_contents('php://input');
$headers = ['apikey: '.$config['supabase_publishable_key'], 'Authorization: Bearer '.$token, 'Content-Type: application/json', 'Prefer: return=representation'];
$curl = curl_init($endpoint);
curl_setopt_array($curl, [CURLOPT_RETURNTRANSFER=>true, CURLOPT_CUSTOMREQUEST=>$method, CURLOPT_HTTPHEADER=>$headers]);
if (in_array($method, ['POST','PATCH'], true)) { curl_setopt($curl, CURLOPT_POSTFIELDS, $body); }
$response = curl_exec($curl); $status = curl_getinfo($curl, CURLINFO_HTTP_CODE); curl_close($curl);
http_response_code($status ?: 500); echo $response ?: json_encode(['error'=>'Falha ao acessar o banco']);
