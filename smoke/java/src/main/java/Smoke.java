// Smoke test for com.marketsdk:marketsdk-java. See smoke/run.mjs for what every test does.

import com.marketsdk.MarketSDK;
import com.marketsdk.core.MarketSDKApiException;
import com.marketsdk.core.RequestOptions;
import com.marketsdk.errors.BadRequestError;
import com.marketsdk.resources.sellers.requests.ListSellersRequest;
import com.marketsdk.types.CreatePartyDto;
import com.marketsdk.types.SellerList;
import com.marketsdk.types.SellerObject;

public class Smoke {
    static void must(boolean cond, String what) {
        if (!cond) {
            System.err.println("failed: " + what);
            System.exit(1);
        }
    }

    public static void main(String[] args) {
        String key = System.getenv("MARKETSDK_KEY");
        String baseUrl = System.getenv("MARKETSDK_BASE_URL");
        String mockUrl = System.getenv("MARKETSDK_MOCK_URL");
        must(key != null && baseUrl != null && mockUrl != null, "MARKETSDK_KEY, MARKETSDK_BASE_URL, and MARKETSDK_MOCK_URL are required");

        MarketSDK client = MarketSDK.builder().token(key).url(baseUrl).build();
        String externalId = "smoke-java-" + System.currentTimeMillis();
        RequestOptions idem = RequestOptions.builder().addHeader("Idempotency-Key", "smoke-java-" + System.nanoTime()).build();

        SellerObject created = client.sellers().createSeller(CreatePartyDto.builder().externalId(externalId).build(), idem);
        must(created.getId().startsWith("sel_"), "created seller has an id");
        must(externalId.equals(created.getExternalId()), "created seller carries external_id");
        SellerObject replayed = client.sellers().createSeller(CreatePartyDto.builder().externalId(externalId).build(), idem);
        must(created.getId().equals(replayed.getId()), "replay returns the same seller");

        SellerList page = client.sellers().listSellers(ListSellersRequest.builder().limit(2.0).build());
        must(page.getData().size() <= 2, "list honours limit");
        SellerObject fetched = client.sellers().getSeller(created.getId());
        must(created.getId().equals(fetched.getId()), "get returns the seller");

        try {
            client.sellers().createSeller(CreatePartyDto.builder().externalId("x".repeat(201)).build());
            must(false, "bad request did not throw");
        } catch (BadRequestError e) {
            must(e.statusCode() == 400, "bad request status is 400");
            must(!e.body().getError().getCode().isEmpty(), "error has code");
            must(!e.body().getError().getRequestId().isEmpty(), "error has request_id");
        } catch (MarketSDKApiException e) {
            must(false, "bad request threw " + e.getClass().getSimpleName() + " with status " + e.statusCode());
        }

        MarketSDK mock = MarketSDK.builder().token(key).url(mockUrl).build();
        SellerObject odd = mock.sellers().getSeller("sel_mock000000000000000000");
        must("hibernating".equals(odd.getStatus().toString()), "unknown enum value passes through (got " + odd.getStatus() + ")");

        System.out.println("ok");
    }
}
