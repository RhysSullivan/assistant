CREATE TABLE "plugin_kv" (
	"scope_id" text NOT NULL,
	"namespace" text NOT NULL,
	"key" text NOT NULL,
	"value" text NOT NULL,
	CONSTRAINT "plugin_kv_scope_id_namespace_key_pk" PRIMARY KEY("scope_id","namespace","key")
);
--> statement-breakpoint
CREATE TABLE "policies" (
	"id" text NOT NULL,
	"scope_id" text NOT NULL,
	"name" text NOT NULL,
	"action" text NOT NULL,
	"match_tool_pattern" text,
	"match_source_id" text,
	"priority" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "policies_id_scope_id_pk" PRIMARY KEY("id","scope_id")
);
--> statement-breakpoint
CREATE TABLE "secrets" (
	"id" text NOT NULL,
	"scope_id" text NOT NULL,
	"name" text NOT NULL,
	"purpose" text,
	"provider" text,
	"encrypted_value" "bytea",
	"iv" "bytea",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "secrets_id_scope_id_pk" PRIMARY KEY("id","scope_id")
);
--> statement-breakpoint
CREATE TABLE "sources" (
	"id" text NOT NULL,
	"scope_id" text NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"config" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sources_id_scope_id_pk" PRIMARY KEY("id","scope_id")
);
--> statement-breakpoint
CREATE TABLE "tool_definitions" (
	"name" text NOT NULL,
	"scope_id" text NOT NULL,
	"schema" jsonb NOT NULL,
	CONSTRAINT "tool_definitions_name_scope_id_pk" PRIMARY KEY("name","scope_id")
);
--> statement-breakpoint
CREATE TABLE "tools" (
	"id" text NOT NULL,
	"scope_id" text NOT NULL,
	"source_id" text NOT NULL,
	"plugin_key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"may_elicit" boolean DEFAULT false,
	"input_schema" jsonb,
	"output_schema" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tools_id_scope_id_pk" PRIMARY KEY("id","scope_id")
);
--> statement-breakpoint
CREATE INDEX "idx_plugin_kv_namespace" ON "plugin_kv" USING btree ("scope_id","namespace");--> statement-breakpoint
CREATE INDEX "idx_tools_source" ON "tools" USING btree ("scope_id","source_id");