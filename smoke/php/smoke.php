<?php
// Smoke test for marketsdk/php. See smoke/run.mjs for what every test does.
declare(strict_types=1);

require __DIR__ . '/vendor/autoload.php';

use MarketSDK\MarketSDKClient;
use MarketSDK\Exceptions\MarketSdkApiException;
use MarketSDK\Sellers\Requests\ListSellersRequest;
use MarketSDK\Types\CreatePartyDto;

function must(bool $cond, string $what): void
{
    if (!$cond) {
        fwrite(STDERR, "failed: $what\n");
        exit(1);
    }
}

$key = getenv('MARKETSDK_KEY');
$baseUrl = getenv('MARKETSDK_BASE_URL');
$mockUrl = getenv('MARKETSDK_MOCK_URL');
must($key && $baseUrl && $mockUrl, 'MARKETSDK_KEY, MARKETSDK_BASE_URL, and MARKETSDK_MOCK_URL are required');

$client = new MarketSDKClient($key, ['baseUrl' => $baseUrl]);
$externalId = 'smoke-php-' . (int) (microtime(true) * 1000);
$idem = ['headers' => ['Idempotency-Key' => 'smoke-php-' . bin2hex(random_bytes(8))]];

$created = $client->sellers->createSeller(new CreatePartyDto(['externalId' => $externalId]), $idem);
must(str_starts_with($created->id, 'sel_'), 'created seller has an id');
must($created->externalId === $externalId, 'created seller carries external_id');
$replayed = $client->sellers->createSeller(new CreatePartyDto(['externalId' => $externalId]), $idem);
must($replayed->id === $created->id, 'replay returns the same seller');

$page = $client->sellers->listSellers(new ListSellersRequest(['limit' => 2]));
must(count($page->data) <= 2, 'list honours limit');
must(is_bool($page->hasMore), 'list has has_more');
$fetched = $client->sellers->getSeller($created->id);
must($fetched->id === $created->id, 'get returns the seller');

try {
    $client->sellers->createSeller(new CreatePartyDto(['externalId' => str_repeat('x', 201)]));
    must(false, 'bad request did not throw');
} catch (MarketSdkApiException $e) {
    must($e->getCode() === 400, 'bad request status is 400 (got ' . $e->getCode() . ')');
    $body = $e->getBody();
    $body = is_string($body) ? json_decode($body, true) : (array) $body;
    $error = (array) ($body['error'] ?? []);
    must(!empty($error['code']), 'error has code');
    must(!empty($error['request_id']), 'error has request_id');
}

$mock = new MarketSDKClient($key, ['baseUrl' => $mockUrl]);
$odd = $mock->sellers->getSeller('sel_mock000000000000000000');
must($odd->status === 'hibernating', 'unknown enum value passes through (got ' . $odd->status . ')');

echo "ok\n";
