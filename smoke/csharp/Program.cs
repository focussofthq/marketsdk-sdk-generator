// Smoke test for the MarketSDK NuGet package. See smoke/run.mjs for what every test does.
using MarketSDK;

static void Must(bool cond, string what)
{
    if (!cond)
    {
        Console.Error.WriteLine("failed: " + what);
        Environment.Exit(1);
    }
}

var key = Environment.GetEnvironmentVariable("MARKETSDK_KEY");
var baseUrl = Environment.GetEnvironmentVariable("MARKETSDK_BASE_URL");
var mockUrl = Environment.GetEnvironmentVariable("MARKETSDK_MOCK_URL");
Must(key != null && baseUrl != null && mockUrl != null, "MARKETSDK_KEY, MARKETSDK_BASE_URL, and MARKETSDK_MOCK_URL are required");

var client = new MarketSDKClient(key, new ClientOptions { BaseUrl = baseUrl! });
var externalId = $"smoke-cs-{DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}";
var idem = new RequestOptions
{
    AdditionalHeaders = new Dictionary<string, string?> { { "Idempotency-Key", $"smoke-cs-{Guid.NewGuid()}" } },
};

var created = await client.Sellers.CreateSellerAsync(new CreatePartyDto { ExternalId = externalId }, idem);
Must(created.Id.StartsWith("sel_"), "created seller has an id");
Must(created.ExternalId == externalId, "created seller carries external_id");
var replayed = await client.Sellers.CreateSellerAsync(new CreatePartyDto { ExternalId = externalId }, idem);
Must(replayed.Id == created.Id, "replay returns the same seller");

var page = await client.Sellers.ListSellersAsync(new ListSellersRequest { Limit = 2 });
Must(page.Data.Count() <= 2, "list honours limit");
var fetched = await client.Sellers.GetSellerAsync(new GetSellerRequest { Id = created.Id });
Must(fetched.Id == created.Id, "get returns the seller");

try
{
    await client.Sellers.CreateSellerAsync(new CreatePartyDto { ExternalId = new string('x', 201) });
    Must(false, "bad request did not throw");
}
catch (BadRequestError e)
{
    Must(e.StatusCode == 400, "bad request status is 400");
    Must(!string.IsNullOrEmpty(e.Body.Error.Code), "error has code");
    Must(!string.IsNullOrEmpty(e.Body.Error.RequestId), "error has request_id");
}
catch (MarketSDKClientApiException e)
{
    Must(false, $"bad request threw {e.GetType().Name} with status {e.StatusCode}");
}

var mock = new MarketSDKClient(key, new ClientOptions { BaseUrl = mockUrl! });
var odd = await mock.Sellers.GetSellerAsync(new GetSellerRequest { Id = "sel_mock000000000000000000" });
Must(odd.Status.Value == "hibernating", $"unknown enum value passes through (got {odd.Status.Value})");

Console.WriteLine("ok");
