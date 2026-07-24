CREATE TABLE "fx_rates" (
	"rate_date" text NOT NULL,
	"currency" text NOT NULL,
	"rate_to_hkd" numeric NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fx_rates_rate_date_currency_pk" PRIMARY KEY("rate_date","currency")
);
