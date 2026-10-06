// Smoke test for github.com/focussofthq/marketsdk-go. See smoke/run.mjs for what every test does.
package main

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"os"
	"strings"
	"time"

	marketsdk "github.com/focussofthq/marketsdk-go"
	"github.com/focussofthq/marketsdk-go/client"
	"github.com/focussofthq/marketsdk-go/option"
)

func must(cond bool, what string) {
	if !cond {
		fmt.Fprintln(os.Stderr, "failed:", what)
		os.Exit(1)
	}
}

func main() {
	key, baseURL, mockURL := os.Getenv("MARKETSDK_KEY"), os.Getenv("MARKETSDK_BASE_URL"), os.Getenv("MARKETSDK_MOCK_URL")
	must(key != "" && baseURL != "" && mockURL != "", "MARKETSDK_KEY, MARKETSDK_BASE_URL, and MARKETSDK_MOCK_URL are required")
	ctx := context.Background()

	c := client.NewClient(option.WithToken(key), option.WithBaseURL(baseURL))
	externalID := fmt.Sprintf("smoke-go-%d", time.Now().UnixMilli())
	idem := http.Header{}
	idem.Set("Idempotency-Key", fmt.Sprintf("smoke-go-%d", time.Now().UnixNano()))

	created, err := c.Sellers.CreateSeller(ctx, &marketsdk.CreatePartyDto{ExternalID: externalID}, option.WithHTTPHeader(idem))
	must(err == nil, fmt.Sprintf("create seller: %v", err))
	must(strings.HasPrefix(created.ID, "sel_"), "created seller has an id")
	must(created.ExternalID == externalID, "created seller carries external_id")
	replayed, err := c.Sellers.CreateSeller(ctx, &marketsdk.CreatePartyDto{ExternalID: externalID}, option.WithHTTPHeader(idem))
	must(err == nil, fmt.Sprintf("replay: %v", err))
	must(replayed.ID == created.ID, "replay returns the same seller")

	limit := 2.0
	page, err := c.Sellers.ListSellers(ctx, &marketsdk.ListSellersRequest{Limit: &limit})
	must(err == nil, fmt.Sprintf("list: %v", err))
	must(len(page.Data) <= 2, "list honours limit")
	fetched, err := c.Sellers.GetSeller(ctx, &marketsdk.GetSellerRequest{ID: created.ID})
	must(err == nil, fmt.Sprintf("get: %v", err))
	must(fetched.ID == created.ID, "get returns the seller")

	_, err = c.Sellers.CreateSeller(ctx, &marketsdk.CreatePartyDto{ExternalID: strings.Repeat("x", 201)})
	must(err != nil, "bad request returns an error")
	var bad *marketsdk.BadRequestError
	must(errors.As(err, &bad), fmt.Sprintf("bad request is a BadRequestError (got %T: %v)", err, err))
	must(bad.StatusCode == 400, "bad request status is 400")
	must(bad.Body != nil && bad.Body.Error != nil && bad.Body.Error.Code != "", "error has code")
	must(bad.Body.Error.RequestID != "", "error has request_id")

	mock := client.NewClient(option.WithToken(key), option.WithBaseURL(mockURL))
	odd, err := mock.Sellers.GetSeller(ctx, &marketsdk.GetSellerRequest{ID: "sel_mock000000000000000000"})
	must(err == nil, fmt.Sprintf("mock get: %v", err))
	must(string(odd.Status) == "hibernating", fmt.Sprintf("unknown enum value passes through (got %q)", odd.Status))

	fmt.Println("ok")
}
