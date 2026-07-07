-- 营销作战地图 PostgreSQL/PostGIS 初始数据库结构
-- 目标版本：PostgreSQL 15+，PostGIS 3+
-- 说明：这是领域建模和 MVP 建库基线；上线前需结合现有 IAM、命名规范和迁移工具调整。

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE SCHEMA IF NOT EXISTS marketing_war_map;
SET search_path TO marketing_war_map, public;

-- -----------------------------------------------------------------------------
-- 通用函数
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

-- -----------------------------------------------------------------------------
-- 行政区划与销售辖区
-- -----------------------------------------------------------------------------

CREATE TABLE geo_region (
    id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    admin_code          varchar(12) NOT NULL,
    region_name         varchar(100) NOT NULL,
    full_name           varchar(300) NOT NULL,
    region_level        smallint NOT NULL CHECK (region_level BETWEEN 0 AND 4),
    parent_id           bigint REFERENCES geo_region(id),
    longitude           numeric(10, 7),
    latitude            numeric(10, 7),
    centroid            geometry(Point, 4326),
    geom                geometry(MultiPolygon, 4326),
    valid_from          date NOT NULL DEFAULT DATE '1900-01-01',
    valid_to            date,
    status              varchar(20) NOT NULL DEFAULT 'ACTIVE'
                        CHECK (status IN ('ACTIVE', 'INACTIVE', 'MERGED')),
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),
    UNIQUE (admin_code, valid_from),
    CHECK (valid_to IS NULL OR valid_to >= valid_from)
);

CREATE INDEX idx_geo_region_parent ON geo_region(parent_id);
CREATE INDEX idx_geo_region_level_status ON geo_region(region_level, status);
CREATE INDEX idx_geo_region_geom ON geo_region USING gist(geom);
CREATE INDEX idx_geo_region_centroid ON geo_region USING gist(centroid);
CREATE UNIQUE INDEX uq_geo_region_active_code
    ON geo_region(admin_code)
    WHERE status = 'ACTIVE';

CREATE TABLE sales_territory (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    territory_code      varchar(50) NOT NULL UNIQUE,
    territory_name      varchar(100) NOT NULL,
    parent_id           uuid REFERENCES sales_territory(id),
    territory_type      varchar(30) NOT NULL DEFAULT 'SALES_REGION'
                        CHECK (territory_type IN ('SALES_REGION', 'TEAM_REGION', 'CUSTOM')),
    owner_user_id       uuid,
    priority            integer NOT NULL DEFAULT 0,
    status              varchar(20) NOT NULL DEFAULT 'ACTIVE'
                        CHECK (status IN ('ACTIVE', 'INACTIVE', 'PLANNING')),
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sales_territory_region (
    territory_id        uuid NOT NULL REFERENCES sales_territory(id) ON DELETE CASCADE,
    region_id           bigint NOT NULL REFERENCES geo_region(id),
    is_primary          boolean NOT NULL DEFAULT true,
    created_at          timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (territory_id, region_id)
);

CREATE INDEX idx_territory_region_region ON sales_territory_region(region_id);

-- -----------------------------------------------------------------------------
-- 用户、团队、角色
-- -----------------------------------------------------------------------------

CREATE TABLE iam_user (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_code           varchar(100) NOT NULL UNIQUE,
    display_name        varchar(100) NOT NULL,
    email               varchar(200),
    mobile              varchar(50),
    department_name     varchar(200),
    status              varchar(20) NOT NULL DEFAULT 'ACTIVE'
                        CHECK (status IN ('ACTIVE', 'DISABLED', 'LOCKED')),
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE sales_territory
    ADD CONSTRAINT fk_sales_territory_owner
    FOREIGN KEY (owner_user_id) REFERENCES iam_user(id);

CREATE TABLE iam_team (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    team_code           varchar(100) NOT NULL UNIQUE,
    team_name           varchar(200) NOT NULL,
    parent_id           uuid REFERENCES iam_team(id),
    leader_user_id      uuid REFERENCES iam_user(id),
    status              varchar(20) NOT NULL DEFAULT 'ACTIVE'
                        CHECK (status IN ('ACTIVE', 'INACTIVE')),
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE iam_team_member (
    team_id             uuid NOT NULL REFERENCES iam_team(id) ON DELETE CASCADE,
    user_id             uuid NOT NULL REFERENCES iam_user(id) ON DELETE CASCADE,
    member_role         varchar(30) NOT NULL DEFAULT 'MEMBER'
                        CHECK (member_role IN ('LEADER', 'MEMBER')),
    joined_at           timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (team_id, user_id)
);

CREATE INDEX idx_iam_team_member_user ON iam_team_member(user_id);

CREATE TABLE iam_role (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    role_code           varchar(100) NOT NULL UNIQUE,
    role_name           varchar(100) NOT NULL,
    data_scope          varchar(20) NOT NULL DEFAULT 'SELF'
                        CHECK (data_scope IN ('ALL', 'TEAM', 'SELF', 'CUSTOM')),
    permission_json     jsonb NOT NULL DEFAULT '{}'::jsonb,
    status              varchar(20) NOT NULL DEFAULT 'ACTIVE'
                        CHECK (status IN ('ACTIVE', 'INACTIVE')),
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE iam_user_role (
    user_id             uuid NOT NULL REFERENCES iam_user(id) ON DELETE CASCADE,
    role_id             uuid NOT NULL REFERENCES iam_role(id) ON DELETE CASCADE,
    created_at          timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, role_id)
);

-- -----------------------------------------------------------------------------
-- 客户/资源与联系人
-- -----------------------------------------------------------------------------

CREATE TABLE crm_account (
    id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    account_code                varchar(50) NOT NULL UNIQUE,
    account_name                varchar(300) NOT NULL,
    standard_name               varchar(300),
    account_category            varchar(30) NOT NULL
                                CHECK (account_category IN (
                                    'GOVERNMENT', 'INDUSTRY', 'PLATFORM',
                                    'PARTNER', 'OTHER'
                                )),
    unified_social_credit_code  varchar(30),
    industry_code               varchar(100),
    organization_level          varchar(50),
    lifecycle_status            varchar(30) NOT NULL DEFAULT 'NEW'
                                CHECK (lifecycle_status IN (
                                    'NEW', 'NURTURING', 'CONTACTED', 'KEY_ACCOUNT',
                                    'IN_OPPORTUNITY', 'CUSTOMER', 'DORMANT', 'INVALID'
                                )),
    customer_grade              varchar(10),
    strategic_level             varchar(20),
    source_code                 varchar(100),
    owner_user_id               uuid NOT NULL REFERENCES iam_user(id),
    primary_region_id           bigint REFERENCES geo_region(id),
    address                     varchar(500),
    longitude                   numeric(10, 7),
    latitude                    numeric(10, 7),
    geom                        geometry(Point, 4326),
    profile_completeness        numeric(5, 2) NOT NULL DEFAULT 0
                                CHECK (profile_completeness BETWEEN 0 AND 100),
    engagement_score            numeric(5, 2) NOT NULL DEFAULT 0
                                CHECK (engagement_score BETWEEN 0 AND 100),
    last_activity_at            timestamptz,
    custom_fields               jsonb NOT NULL DEFAULT '{}'::jsonb,
    version                     integer NOT NULL DEFAULT 1,
    is_deleted                  boolean NOT NULL DEFAULT false,
    deleted_at                  timestamptz,
    created_by                  uuid NOT NULL REFERENCES iam_user(id),
    updated_by                  uuid NOT NULL REFERENCES iam_user(id),
    created_at                  timestamptz NOT NULL DEFAULT now(),
    updated_at                  timestamptz NOT NULL DEFAULT now(),
    CHECK ((is_deleted = false AND deleted_at IS NULL) OR is_deleted = true)
);

CREATE UNIQUE INDEX uq_crm_account_credit_code
    ON crm_account(unified_social_credit_code)
    WHERE unified_social_credit_code IS NOT NULL AND is_deleted = false;
CREATE INDEX idx_crm_account_owner ON crm_account(owner_user_id) WHERE is_deleted = false;
CREATE INDEX idx_crm_account_region_category ON crm_account(primary_region_id, account_category)
    WHERE is_deleted = false;
CREATE INDEX idx_crm_account_lifecycle ON crm_account(lifecycle_status) WHERE is_deleted = false;
CREATE INDEX idx_crm_account_standard_name_trgm
    ON crm_account USING gin(standard_name gin_trgm_ops)
    WHERE standard_name IS NOT NULL AND is_deleted = false;
CREATE INDEX idx_crm_account_geom ON crm_account USING gist(geom);
CREATE INDEX idx_crm_account_custom_fields ON crm_account USING gin(custom_fields);

CREATE TABLE crm_contact (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    contact_name        varchar(100) NOT NULL,
    gender              varchar(20),
    mobile              varchar(50),
    email               varchar(200),
    wechat              varchar(100),
    status              varchar(20) NOT NULL DEFAULT 'ACTIVE'
                        CHECK (status IN ('ACTIVE', 'INACTIVE', 'LEFT')),
    owner_user_id       uuid NOT NULL REFERENCES iam_user(id),
    source_code         varchar(100),
    custom_fields       jsonb NOT NULL DEFAULT '{}'::jsonb,
    is_deleted          boolean NOT NULL DEFAULT false,
    deleted_at          timestamptz,
    created_by          uuid NOT NULL REFERENCES iam_user(id),
    updated_by          uuid NOT NULL REFERENCES iam_user(id),
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_crm_contact_owner ON crm_contact(owner_user_id) WHERE is_deleted = false;
CREATE INDEX idx_crm_contact_mobile ON crm_contact(mobile) WHERE mobile IS NOT NULL AND is_deleted = false;
CREATE INDEX idx_crm_contact_email ON crm_contact(email) WHERE email IS NOT NULL AND is_deleted = false;

CREATE TABLE crm_account_contact (
    account_id          uuid NOT NULL REFERENCES crm_account(id),
    contact_id          uuid NOT NULL REFERENCES crm_contact(id),
    department_name     varchar(200),
    title               varchar(200),
    decision_role       varchar(50)
                        CHECK (decision_role IS NULL OR decision_role IN (
                            'DECISION_MAKER', 'TECHNICAL_DECISION_MAKER',
                            'BUSINESS_OWNER', 'PROCUREMENT', 'FINANCE',
                            'INFLUENCER', 'GATEKEEPER', 'USER', 'OTHER'
                        )),
    relation_strength   smallint CHECK (relation_strength BETWEEN 1 AND 5),
    influence_level     smallint CHECK (influence_level BETWEEN 1 AND 5),
    is_primary          boolean NOT NULL DEFAULT false,
    status              varchar(20) NOT NULL DEFAULT 'ACTIVE'
                        CHECK (status IN ('ACTIVE', 'INACTIVE')),
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (account_id, contact_id)
);

CREATE INDEX idx_account_contact_contact ON crm_account_contact(contact_id);

-- -----------------------------------------------------------------------------
-- 商机流程、阶段和项目推进
-- -----------------------------------------------------------------------------

CREATE TABLE crm_pipeline (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    pipeline_code       varchar(100) NOT NULL UNIQUE,
    pipeline_name       varchar(200) NOT NULL,
    applies_to          varchar(30) NOT NULL DEFAULT 'OPPORTUNITY'
                        CHECK (applies_to IN ('OPPORTUNITY', 'PARTNER', 'DELIVERY_PROJECT')),
    description         text,
    is_default          boolean NOT NULL DEFAULT false,
    status              varchar(20) NOT NULL DEFAULT 'ACTIVE'
                        CHECK (status IN ('ACTIVE', 'INACTIVE')),
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE crm_pipeline_stage (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    pipeline_id         uuid NOT NULL REFERENCES crm_pipeline(id) ON DELETE CASCADE,
    stage_code          varchar(100) NOT NULL,
    stage_name          varchar(100) NOT NULL,
    stage_group         varchar(20) NOT NULL
                        CHECK (stage_group IN ('OPEN', 'WON', 'LOST', 'ON_HOLD')),
    sort_order          integer NOT NULL,
    default_probability numeric(5, 2) NOT NULL DEFAULT 0
                        CHECK (default_probability BETWEEN 0 AND 100),
    sla_days            integer CHECK (sla_days IS NULL OR sla_days > 0),
    required_fields     jsonb NOT NULL DEFAULT '[]'::jsonb,
    edit_role_codes     jsonb NOT NULL DEFAULT '[]'::jsonb,
    status              varchar(20) NOT NULL DEFAULT 'ACTIVE'
                        CHECK (status IN ('ACTIVE', 'INACTIVE')),
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),
    UNIQUE (pipeline_id, stage_code),
    UNIQUE (pipeline_id, sort_order),
    UNIQUE (pipeline_id, id)
);

CREATE INDEX idx_pipeline_stage_pipeline ON crm_pipeline_stage(pipeline_id, sort_order);

CREATE TABLE crm_opportunity (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    opportunity_code    varchar(50) NOT NULL UNIQUE,
    opportunity_name    varchar(300) NOT NULL,
    primary_account_id  uuid NOT NULL REFERENCES crm_account(id),
    opportunity_type    varchar(40) NOT NULL
                        CHECK (opportunity_type IN (
                            'GOVERNMENT_PROJECT', 'INDUSTRY_PROJECT',
                            'PLATFORM_PROJECT', 'STANDALONE',
                            'PARTNER_DELIVERY', 'OTHER'
                        )),
    pipeline_id         uuid NOT NULL REFERENCES crm_pipeline(id),
    current_stage_id    uuid NOT NULL,
    status              varchar(20) NOT NULL DEFAULT 'OPEN'
                        CHECK (status IN ('OPEN', 'WON', 'LOST', 'ON_HOLD', 'CANCELLED')),
    owner_user_id       uuid NOT NULL REFERENCES iam_user(id),
    presales_user_id    uuid REFERENCES iam_user(id),
    primary_region_id   bigint REFERENCES geo_region(id),
    address             varchar(500),
    longitude           numeric(10, 7),
    latitude            numeric(10, 7),
    geom                geometry(Point, 4326),
    amount              numeric(18, 2) NOT NULL DEFAULT 0 CHECK (amount >= 0),
    currency            char(3) NOT NULL DEFAULT 'CNY',
    probability         numeric(5, 2) NOT NULL DEFAULT 0
                        CHECK (probability BETWEEN 0 AND 100),
    weighted_amount     numeric(18, 2)
                        GENERATED ALWAYS AS (round(amount * probability / 100.0, 2)) STORED,
    priority            varchar(10) NOT NULL DEFAULT 'P2'
                        CHECK (priority IN ('P0', 'P1', 'P2', 'P3')),
    health_status       varchar(20) NOT NULL DEFAULT 'GREEN'
                        CHECK (health_status IN ('GREEN', 'YELLOW', 'RED', 'GRAY')),
    source_code         varchar(100),
    referral_unit       varchar(300),
    requirement_summary text,
    decision_chain_summary text,
    budget_status       varchar(50),
    procurement_method  varchar(100),
    competitor_summary  text,
    risk_summary        text,
    expected_close_date date,
    bid_deadline        timestamptz,
    next_action         text,
    next_action_at      timestamptz,
    current_stage_at    timestamptz NOT NULL DEFAULT now(),
    last_activity_at    timestamptz,
    actual_close_date   date,
    win_loss_reason     text,
    custom_fields       jsonb NOT NULL DEFAULT '{}'::jsonb,
    version             integer NOT NULL DEFAULT 1,
    is_deleted          boolean NOT NULL DEFAULT false,
    deleted_at          timestamptz,
    created_by          uuid NOT NULL REFERENCES iam_user(id),
    updated_by          uuid NOT NULL REFERENCES iam_user(id),
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (pipeline_id, current_stage_id)
        REFERENCES crm_pipeline_stage(pipeline_id, id),
    CHECK ((status IN ('WON', 'LOST', 'CANCELLED') AND actual_close_date IS NOT NULL)
           OR status IN ('OPEN', 'ON_HOLD'))
);

CREATE INDEX idx_crm_opportunity_owner_status ON crm_opportunity(owner_user_id, status)
    WHERE is_deleted = false;
CREATE INDEX idx_crm_opportunity_account ON crm_opportunity(primary_account_id)
    WHERE is_deleted = false;
CREATE INDEX idx_crm_opportunity_stage ON crm_opportunity(current_stage_id, status)
    WHERE is_deleted = false;
CREATE INDEX idx_crm_opportunity_region_health ON crm_opportunity(primary_region_id, health_status)
    WHERE is_deleted = false;
CREATE INDEX idx_crm_opportunity_close_date ON crm_opportunity(expected_close_date)
    WHERE status = 'OPEN' AND is_deleted = false;
CREATE INDEX idx_crm_opportunity_next_action ON crm_opportunity(next_action_at)
    WHERE status = 'OPEN' AND is_deleted = false;
CREATE INDEX idx_crm_opportunity_geom ON crm_opportunity USING gist(geom);
CREATE INDEX idx_crm_opportunity_custom_fields ON crm_opportunity USING gin(custom_fields);

CREATE TABLE crm_opportunity_account_role (
    opportunity_id      uuid NOT NULL REFERENCES crm_opportunity(id) ON DELETE CASCADE,
    account_id          uuid NOT NULL REFERENCES crm_account(id),
    role_type           varchar(50) NOT NULL
                        CHECK (role_type IN (
                            'PRIMARY_CUSTOMER', 'SPONSOR', 'BUDGET_OWNER',
                            'PLATFORM_OPERATOR', 'GENERAL_INTEGRATOR',
                            'IMPLEMENTATION_PARTNER', 'COOPERATION_PARTNER',
                            'COMPETITOR', 'OTHER'
                        )),
    role_description    text,
    is_primary          boolean NOT NULL DEFAULT false,
    created_at          timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (opportunity_id, account_id, role_type)
);

CREATE INDEX idx_opp_account_role_account ON crm_opportunity_account_role(account_id);

CREATE TABLE crm_opportunity_contact_role (
    opportunity_id      uuid NOT NULL REFERENCES crm_opportunity(id) ON DELETE CASCADE,
    contact_id          uuid NOT NULL REFERENCES crm_contact(id),
    role_type           varchar(50) NOT NULL,
    influence_level     smallint CHECK (influence_level BETWEEN 1 AND 5),
    support_level       smallint CHECK (support_level BETWEEN -2 AND 2),
    is_primary          boolean NOT NULL DEFAULT false,
    notes               text,
    created_at          timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (opportunity_id, contact_id, role_type)
);

CREATE INDEX idx_opp_contact_role_contact ON crm_opportunity_contact_role(contact_id);

CREATE TABLE crm_stage_history (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    opportunity_id      uuid NOT NULL REFERENCES crm_opportunity(id) ON DELETE CASCADE,
    from_stage_id       uuid REFERENCES crm_pipeline_stage(id),
    to_stage_id         uuid NOT NULL REFERENCES crm_pipeline_stage(id),
    from_probability    numeric(5, 2),
    to_probability      numeric(5, 2),
    change_reason       text,
    changed_by          uuid NOT NULL REFERENCES iam_user(id),
    changed_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_stage_history_opportunity_time
    ON crm_stage_history(opportunity_id, changed_at DESC);

CREATE TABLE crm_activity (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    activity_type       varchar(30) NOT NULL
                        CHECK (activity_type IN (
                            'VISIT', 'CALL', 'MEETING', 'SOLUTION', 'BID',
                            'EMAIL', 'MINUTES', 'OTHER'
                        )),
    subject             varchar(300) NOT NULL,
    content             text,
    account_id          uuid REFERENCES crm_account(id),
    opportunity_id      uuid REFERENCES crm_opportunity(id),
    contact_id          uuid REFERENCES crm_contact(id),
    occurred_at         timestamptz NOT NULL,
    duration_minutes    integer CHECK (duration_minutes IS NULL OR duration_minutes >= 0),
    location            varchar(300),
    next_action         text,
    next_action_at      timestamptz,
    created_by          uuid NOT NULL REFERENCES iam_user(id),
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),
    CHECK (account_id IS NOT NULL OR opportunity_id IS NOT NULL)
);

CREATE INDEX idx_activity_account_time ON crm_activity(account_id, occurred_at DESC);
CREATE INDEX idx_activity_opportunity_time ON crm_activity(opportunity_id, occurred_at DESC);
CREATE INDEX idx_activity_creator_time ON crm_activity(created_by, occurred_at DESC);

CREATE TABLE crm_task (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    task_type           varchar(30) NOT NULL DEFAULT 'FOLLOW_UP'
                        CHECK (task_type IN (
                            'FOLLOW_UP', 'MEETING', 'DOCUMENT', 'BID',
                            'APPROVAL', 'REMINDER', 'OTHER'
                        )),
    subject             varchar(300) NOT NULL,
    description         text,
    account_id          uuid REFERENCES crm_account(id),
    opportunity_id      uuid REFERENCES crm_opportunity(id),
    assignee_user_id    uuid NOT NULL REFERENCES iam_user(id),
    priority            varchar(10) NOT NULL DEFAULT 'P2'
                        CHECK (priority IN ('P0', 'P1', 'P2', 'P3')),
    due_at              timestamptz NOT NULL,
    reminder_at         timestamptz,
    status              varchar(20) NOT NULL DEFAULT 'OPEN'
                        CHECK (status IN ('OPEN', 'DONE', 'CANCELLED')),
    completed_at        timestamptz,
    created_by          uuid NOT NULL REFERENCES iam_user(id),
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),
    CHECK (account_id IS NOT NULL OR opportunity_id IS NOT NULL),
    CHECK ((status = 'DONE' AND completed_at IS NOT NULL) OR status <> 'DONE')
);

CREATE INDEX idx_task_assignee_due ON crm_task(assignee_user_id, status, due_at);
CREATE INDEX idx_task_opportunity ON crm_task(opportunity_id, status);

CREATE TABLE crm_record_collaborator (
    entity_type         varchar(30) NOT NULL
                        CHECK (entity_type IN ('ACCOUNT', 'CONTACT', 'OPPORTUNITY', 'PROJECT')),
    entity_id           uuid NOT NULL,
    user_id             uuid NOT NULL REFERENCES iam_user(id),
    collaborator_role   varchar(30) NOT NULL DEFAULT 'COLLABORATOR',
    can_edit            boolean NOT NULL DEFAULT false,
    created_by          uuid NOT NULL REFERENCES iam_user(id),
    created_at          timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (entity_type, entity_id, user_id)
);

CREATE INDEX idx_record_collaborator_user ON crm_record_collaborator(user_id, entity_type);

-- -----------------------------------------------------------------------------
-- 合作伙伴与交付项目
-- -----------------------------------------------------------------------------

CREATE TABLE crm_partner_profile (
    account_id              uuid PRIMARY KEY REFERENCES crm_account(id),
    partner_level           varchar(20),
    certification_status    varchar(30) NOT NULL DEFAULT 'PENDING'
                            CHECK (certification_status IN (
                                'PENDING', 'CERTIFIED', 'SUSPENDED', 'REJECTED'
                            )),
    delivery_rating         numeric(5, 2) CHECK (delivery_rating BETWEEN 0 AND 100),
    available_capacity      numeric(12, 2),
    capacity_unit           varchar(30),
    service_description     text,
    risk_summary            text,
    custom_fields           jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at              timestamptz NOT NULL DEFAULT now(),
    updated_at              timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE crm_partner_capability (
    id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    partner_account_id      uuid NOT NULL REFERENCES crm_account(id) ON DELETE CASCADE,
    capability_code         varchar(100) NOT NULL,
    capability_name         varchar(200) NOT NULL,
    region_id               bigint REFERENCES geo_region(id),
    capability_grade        varchar(20),
    certification_name      varchar(300),
    valid_from              date,
    valid_to                date,
    notes                   text,
    created_at              timestamptz NOT NULL DEFAULT now(),
    updated_at              timestamptz NOT NULL DEFAULT now(),
    UNIQUE (partner_account_id, capability_code, region_id)
);

CREATE INDEX idx_partner_capability_region
    ON crm_partner_capability(region_id, capability_code);

CREATE TABLE crm_delivery_project (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_code        varchar(50) NOT NULL UNIQUE,
    project_name        varchar(300) NOT NULL,
    opportunity_id      uuid UNIQUE REFERENCES crm_opportunity(id),
    customer_account_id uuid NOT NULL REFERENCES crm_account(id),
    owner_user_id       uuid NOT NULL REFERENCES iam_user(id),
    primary_region_id   bigint REFERENCES geo_region(id),
    project_status      varchar(30) NOT NULL DEFAULT 'PREPARING'
                        CHECK (project_status IN (
                            'PREPARING', 'IN_PROGRESS', 'ACCEPTANCE',
                            'COMPLETED', 'SUSPENDED', 'CANCELLED'
                        )),
    contract_amount     numeric(18, 2) NOT NULL DEFAULT 0 CHECK (contract_amount >= 0),
    start_date          date,
    planned_end_date    date,
    actual_end_date     date,
    delivery_summary    text,
    risk_summary        text,
    custom_fields       jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),
    CHECK (planned_end_date IS NULL OR start_date IS NULL OR planned_end_date >= start_date)
);

CREATE TABLE crm_delivery_project_partner (
    project_id          uuid NOT NULL REFERENCES crm_delivery_project(id) ON DELETE CASCADE,
    partner_account_id  uuid NOT NULL REFERENCES crm_account(id),
    role_type           varchar(50) NOT NULL,
    work_scope          text,
    planned_capacity    numeric(12, 2),
    status              varchar(20) NOT NULL DEFAULT 'PLANNED'
                        CHECK (status IN ('PLANNED', 'CONFIRMED', 'IN_PROGRESS', 'DONE', 'EXITED')),
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (project_id, partner_account_id, role_type)
);

-- -----------------------------------------------------------------------------
-- 标签、分群、自定义字段和保存视图
-- -----------------------------------------------------------------------------

CREATE TABLE crm_tag (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tag_code            varchar(100) NOT NULL UNIQUE,
    tag_name            varchar(100) NOT NULL,
    tag_group           varchar(100),
    color               varchar(20),
    status              varchar(20) NOT NULL DEFAULT 'ACTIVE'
                        CHECK (status IN ('ACTIVE', 'INACTIVE')),
    created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE crm_entity_tag (
    entity_type         varchar(30) NOT NULL
                        CHECK (entity_type IN ('ACCOUNT', 'CONTACT', 'OPPORTUNITY', 'PARTNER', 'PROJECT')),
    entity_id           uuid NOT NULL,
    tag_id              uuid NOT NULL REFERENCES crm_tag(id) ON DELETE CASCADE,
    tagged_by           uuid NOT NULL REFERENCES iam_user(id),
    tagged_at           timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (entity_type, entity_id, tag_id)
);

CREATE INDEX idx_entity_tag_tag ON crm_entity_tag(tag_id, entity_type);

CREATE TABLE crm_segment (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    segment_code        varchar(100) NOT NULL UNIQUE,
    segment_name        varchar(200) NOT NULL,
    entity_type         varchar(30) NOT NULL
                        CHECK (entity_type IN ('ACCOUNT', 'CONTACT', 'OPPORTUNITY', 'PARTNER')),
    segment_type        varchar(20) NOT NULL DEFAULT 'DYNAMIC'
                        CHECK (segment_type IN ('STATIC', 'DYNAMIC')),
    rule_json           jsonb NOT NULL DEFAULT '{}'::jsonb,
    refresh_cron        varchar(100),
    owner_user_id       uuid NOT NULL REFERENCES iam_user(id),
    status              varchar(20) NOT NULL DEFAULT 'ACTIVE'
                        CHECK (status IN ('ACTIVE', 'INACTIVE')),
    last_refreshed_at   timestamptz,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE crm_segment_member (
    segment_id          uuid NOT NULL REFERENCES crm_segment(id) ON DELETE CASCADE,
    entity_id           uuid NOT NULL,
    joined_at           timestamptz NOT NULL DEFAULT now(),
    expires_at          timestamptz,
    PRIMARY KEY (segment_id, entity_id)
);

CREATE TABLE meta_custom_field_definition (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_type         varchar(30) NOT NULL
                        CHECK (entity_type IN ('ACCOUNT', 'CONTACT', 'OPPORTUNITY', 'PARTNER', 'PROJECT')),
    field_key           varchar(100) NOT NULL,
    field_name          varchar(200) NOT NULL,
    field_type          varchar(30) NOT NULL
                        CHECK (field_type IN (
                            'TEXT', 'LONG_TEXT', 'NUMBER', 'CURRENCY', 'DATE',
                            'DATETIME', 'BOOLEAN', 'SINGLE_SELECT', 'MULTI_SELECT',
                            'USER', 'REGION', 'REFERENCE'
                        )),
    option_json         jsonb NOT NULL DEFAULT '{}'::jsonb,
    is_required         boolean NOT NULL DEFAULT false,
    is_filterable       boolean NOT NULL DEFAULT true,
    is_exportable       boolean NOT NULL DEFAULT true,
    sort_order          integer NOT NULL DEFAULT 0,
    status              varchar(20) NOT NULL DEFAULT 'ACTIVE'
                        CHECK (status IN ('ACTIVE', 'INACTIVE')),
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),
    UNIQUE (entity_type, field_key)
);

CREATE TABLE meta_saved_view (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    view_name           varchar(200) NOT NULL,
    entity_type         varchar(30) NOT NULL
                        CHECK (entity_type IN ('ACCOUNT', 'CONTACT', 'OPPORTUNITY', 'PARTNER', 'PROJECT')),
    view_type           varchar(20) NOT NULL DEFAULT 'GRID'
                        CHECK (view_type IN ('GRID', 'BOARD', 'MAP', 'CALENDAR', 'DASHBOARD')),
    scope_type          varchar(20) NOT NULL DEFAULT 'PRIVATE'
                        CHECK (scope_type IN ('PRIVATE', 'TEAM', 'PUBLIC')),
    owner_user_id       uuid NOT NULL REFERENCES iam_user(id),
    team_id             uuid REFERENCES iam_team(id),
    config_json         jsonb NOT NULL DEFAULT '{}'::jsonb,
    is_default          boolean NOT NULL DEFAULT false,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),
    CHECK ((scope_type = 'TEAM' AND team_id IS NOT NULL) OR scope_type <> 'TEAM')
);

-- -----------------------------------------------------------------------------
-- 告警规则与告警事件
-- -----------------------------------------------------------------------------

CREATE TABLE meta_alert_rule (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    rule_code           varchar(100) NOT NULL UNIQUE,
    rule_name           varchar(200) NOT NULL,
    entity_type         varchar(30) NOT NULL DEFAULT 'OPPORTUNITY',
    rule_type           varchar(30) NOT NULL
                        CHECK (rule_type IN (
                            'TASK_OVERDUE', 'STAGE_STAGNANT', 'DATE_APPROACHING',
                            'CLOSE_DATE_PASSED', 'NO_NEXT_ACTION', 'MISSING_DATA',
                            'DUPLICATE', 'PARTNER_CAPACITY', 'CUSTOM'
                        )),
    condition_json      jsonb NOT NULL,
    severity            varchar(20) NOT NULL
                        CHECK (severity IN ('INFO', 'YELLOW', 'RED')),
    notification_json   jsonb NOT NULL DEFAULT '{}'::jsonb,
    status              varchar(20) NOT NULL DEFAULT 'ACTIVE'
                        CHECK (status IN ('ACTIVE', 'INACTIVE')),
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE crm_alert_event (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    rule_id             uuid NOT NULL REFERENCES meta_alert_rule(id),
    entity_type         varchar(30) NOT NULL,
    entity_id           uuid NOT NULL,
    severity            varchar(20) NOT NULL
                        CHECK (severity IN ('INFO', 'YELLOW', 'RED')),
    alert_title         varchar(300) NOT NULL,
    alert_message       text,
    owner_user_id       uuid REFERENCES iam_user(id),
    status              varchar(20) NOT NULL DEFAULT 'OPEN'
                        CHECK (status IN ('OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'IGNORED')),
    triggered_at        timestamptz NOT NULL DEFAULT now(),
    acknowledged_by     uuid REFERENCES iam_user(id),
    acknowledged_at     timestamptz,
    resolved_by         uuid REFERENCES iam_user(id),
    resolved_at         timestamptz,
    resolution_note     text,
    UNIQUE (rule_id, entity_type, entity_id, triggered_at)
);

CREATE INDEX idx_alert_owner_status ON crm_alert_event(owner_user_id, status, severity, triggered_at DESC);
CREATE INDEX idx_alert_entity ON crm_alert_event(entity_type, entity_id, status);

-- -----------------------------------------------------------------------------
-- 数据来源、外部身份、导入和审计
-- -----------------------------------------------------------------------------

CREATE TABLE ops_data_source (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    source_code         varchar(100) NOT NULL UNIQUE,
    source_name         varchar(200) NOT NULL,
    source_type         varchar(30) NOT NULL
                        CHECK (source_type IN ('MANUAL', 'IMPORT', 'CRM', 'API', 'OTHER')),
    config_json         jsonb NOT NULL DEFAULT '{}'::jsonb,
    status              varchar(20) NOT NULL DEFAULT 'ACTIVE'
                        CHECK (status IN ('ACTIVE', 'INACTIVE')),
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ops_external_identity (
    data_source_id      uuid NOT NULL REFERENCES ops_data_source(id) ON DELETE CASCADE,
    entity_type         varchar(30) NOT NULL,
    external_id         varchar(300) NOT NULL,
    internal_entity_id  uuid NOT NULL,
    source_hash         varchar(128),
    last_synced_at      timestamptz,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (data_source_id, entity_type, external_id)
);

CREATE INDEX idx_external_identity_internal
    ON ops_external_identity(entity_type, internal_entity_id);

CREATE TABLE ops_import_template (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    template_code       varchar(100) NOT NULL,
    template_name       varchar(200) NOT NULL,
    entity_type         varchar(30) NOT NULL,
    version_no          integer NOT NULL,
    mapping_json        jsonb NOT NULL,
    validation_json     jsonb NOT NULL DEFAULT '{}'::jsonb,
    file_object_key     varchar(500),
    status              varchar(20) NOT NULL DEFAULT 'ACTIVE'
                        CHECK (status IN ('ACTIVE', 'INACTIVE')),
    created_by          uuid NOT NULL REFERENCES iam_user(id),
    created_at          timestamptz NOT NULL DEFAULT now(),
    UNIQUE (template_code, version_no)
);

CREATE TABLE ops_import_job (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    template_id         uuid REFERENCES ops_import_template(id),
    data_source_id      uuid REFERENCES ops_data_source(id),
    entity_type         varchar(30) NOT NULL,
    file_name           varchar(500) NOT NULL,
    file_object_key     varchar(500) NOT NULL,
    file_hash           varchar(128),
    status              varchar(20) NOT NULL DEFAULT 'UPLOADED'
                        CHECK (status IN (
                            'UPLOADED', 'VALIDATING', 'READY', 'IMPORTING',
                            'SUCCEEDED', 'PARTIAL_SUCCESS', 'FAILED', 'CANCELLED'
                        )),
    total_rows          integer NOT NULL DEFAULT 0,
    valid_rows          integer NOT NULL DEFAULT 0,
    created_rows        integer NOT NULL DEFAULT 0,
    updated_rows        integer NOT NULL DEFAULT 0,
    duplicate_rows      integer NOT NULL DEFAULT 0,
    failed_rows         integer NOT NULL DEFAULT 0,
    result_object_key   varchar(500),
    requested_by        uuid NOT NULL REFERENCES iam_user(id),
    started_at          timestamptz,
    finished_at         timestamptz,
    created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_import_job_requester_time ON ops_import_job(requested_by, created_at DESC);
CREATE INDEX idx_import_job_status ON ops_import_job(status, created_at);

CREATE TABLE ops_import_error (
    id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    import_job_id       uuid NOT NULL REFERENCES ops_import_job(id) ON DELETE CASCADE,
    row_no              integer NOT NULL,
    column_name         varchar(200),
    error_code          varchar(100) NOT NULL,
    error_message       text NOT NULL,
    raw_row_json        jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_import_error_job_row ON ops_import_error(import_job_id, row_no);

CREATE TABLE ops_attachment (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_type         varchar(30) NOT NULL,
    entity_id           uuid NOT NULL,
    file_name           varchar(500) NOT NULL,
    object_key          varchar(500) NOT NULL,
    content_type        varchar(200),
    file_size_bytes     bigint CHECK (file_size_bytes IS NULL OR file_size_bytes >= 0),
    file_hash           varchar(128),
    uploaded_by         uuid NOT NULL REFERENCES iam_user(id),
    uploaded_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_attachment_entity ON ops_attachment(entity_type, entity_id);

CREATE TABLE ops_audit_log (
    id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    entity_type         varchar(50) NOT NULL,
    entity_id           uuid,
    action              varchar(30) NOT NULL
                        CHECK (action IN (
                            'CREATE', 'UPDATE', 'DELETE', 'RESTORE', 'MERGE',
                            'IMPORT', 'EXPORT', 'STAGE_CHANGE', 'OWNER_TRANSFER',
                            'LOGIN', 'PERMISSION_CHANGE'
                        )),
    old_data            jsonb,
    new_data            jsonb,
    changed_fields      jsonb,
    operator_user_id    uuid REFERENCES iam_user(id),
    request_id          varchar(100),
    ip_address          inet,
    user_agent          text,
    occurred_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_entity_time ON ops_audit_log(entity_type, entity_id, occurred_at DESC);
CREATE INDEX idx_audit_operator_time ON ops_audit_log(operator_user_id, occurred_at DESC);

-- -----------------------------------------------------------------------------
-- BI 每日快照
-- -----------------------------------------------------------------------------

CREATE TABLE bi_opportunity_daily_snapshot (
    snapshot_date       date NOT NULL,
    opportunity_id      uuid NOT NULL REFERENCES crm_opportunity(id),
    owner_user_id       uuid NOT NULL REFERENCES iam_user(id),
    region_id           bigint REFERENCES geo_region(id),
    account_category    varchar(30),
    opportunity_type    varchar(40) NOT NULL,
    stage_id            uuid NOT NULL REFERENCES crm_pipeline_stage(id),
    status              varchar(20) NOT NULL,
    health_status       varchar(20) NOT NULL,
    amount              numeric(18, 2) NOT NULL,
    probability         numeric(5, 2) NOT NULL,
    weighted_amount     numeric(18, 2) NOT NULL,
    stage_age_days      integer,
    days_since_activity integer,
    expected_close_date date,
    snapshotted_at      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (snapshot_date, opportunity_id)
);

CREATE INDEX idx_bi_snapshot_region_date
    ON bi_opportunity_daily_snapshot(region_id, snapshot_date);
CREATE INDEX idx_bi_snapshot_owner_date
    ON bi_opportunity_daily_snapshot(owner_user_id, snapshot_date);
CREATE INDEX idx_bi_snapshot_stage_date
    ON bi_opportunity_daily_snapshot(stage_id, snapshot_date);

-- -----------------------------------------------------------------------------
-- 地图统一读取视图
-- PostgreSQL 15+ security_invoker 使视图沿用基表 RLS，而不是以视图所有者绕过。
-- -----------------------------------------------------------------------------

CREATE VIEW vw_map_battle_object
WITH (security_invoker = true)
AS
SELECT
    a.id AS object_id,
    CASE WHEN a.account_category = 'PARTNER' THEN 'PARTNER' ELSE 'RESOURCE' END AS object_kind,
    CASE a.account_category
        WHEN 'GOVERNMENT' THEN 'GOVERNMENT_RESOURCE'
        WHEN 'INDUSTRY' THEN 'INDUSTRY_RESOURCE'
        WHEN 'PLATFORM' THEN 'PLATFORM_RESOURCE'
        WHEN 'PARTNER' THEN 'IMPLEMENTATION_PARTNER'
        ELSE 'OTHER'
    END AS display_category,
    a.account_name AS object_name,
    a.primary_region_id AS region_id,
    a.geom,
    a.owner_user_id,
    NULL::uuid AS stage_id,
    NULL::varchar AS stage_name,
    NULL::numeric(18, 2) AS amount,
    CASE WHEN a.lifecycle_status IN ('DORMANT', 'INVALID') THEN 'GRAY' ELSE 'GREEN' END AS health_status,
    NULL::varchar(300) AS referral_unit,
    NULL::timestamptz AS next_action_at,
    a.updated_at
FROM crm_account a
WHERE a.is_deleted = false
  AND a.account_category IN ('GOVERNMENT', 'INDUSTRY', 'PLATFORM', 'PARTNER')

UNION ALL

SELECT
    o.id AS object_id,
    'OPPORTUNITY' AS object_kind,
    CASE
        WHEN o.opportunity_type = 'STANDALONE' THEN 'STANDALONE_PROJECT'
        WHEN a.account_category = 'GOVERNMENT' THEN 'GOVERNMENT_RESOURCE'
        WHEN a.account_category = 'INDUSTRY' THEN 'INDUSTRY_RESOURCE'
        WHEN a.account_category = 'PLATFORM' THEN 'PLATFORM_RESOURCE'
        WHEN a.account_category = 'PARTNER' THEN 'IMPLEMENTATION_PARTNER'
        ELSE 'STANDALONE_PROJECT'
    END AS display_category,
    o.opportunity_name AS object_name,
    COALESCE(o.primary_region_id, a.primary_region_id) AS region_id,
    COALESCE(o.geom, a.geom) AS geom,
    o.owner_user_id,
    o.current_stage_id AS stage_id,
    s.stage_name,
    o.amount,
    o.health_status,
    o.referral_unit,
    o.next_action_at,
    o.updated_at
FROM crm_opportunity o
JOIN crm_account a ON a.id = o.primary_account_id
JOIN crm_pipeline_stage s ON s.id = o.current_stage_id
WHERE o.is_deleted = false;

-- -----------------------------------------------------------------------------
-- 行级数据权限参考实现
-- 每个请求需由应用连接层设置：
--   SET LOCAL app.user_id = '<当前用户 UUID>';
--   SET LOCAL app.data_scope = 'SELF' | 'TEAM' | 'ALL';
-- 售前/管理员可设置 ALL；销售设置 SELF；销售经理可设置 TEAM。
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app_user_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
    SELECT NULLIF(current_setting('app.user_id', true), '')::uuid;
$$;

CREATE OR REPLACE FUNCTION app_data_scope()
RETURNS varchar
LANGUAGE sql
STABLE
AS $$
    SELECT upper(COALESCE(NULLIF(current_setting('app.data_scope', true), ''), 'SELF'));
$$;

CREATE OR REPLACE FUNCTION can_access_record(
    record_owner_id uuid,
    record_entity_type varchar,
    record_entity_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = marketing_war_map, public
AS $$
    SELECT CASE
        WHEN app_user_id() IS NULL THEN false
        WHEN app_data_scope() = 'ALL' THEN true
        WHEN record_owner_id = app_user_id() THEN true
        WHEN EXISTS (
            SELECT 1
            FROM crm_record_collaborator c
            WHERE c.entity_type = record_entity_type
              AND c.entity_id = record_entity_id
              AND c.user_id = app_user_id()
        ) THEN true
        WHEN app_data_scope() = 'TEAM' AND EXISTS (
            SELECT 1
            FROM iam_team_member current_member
            JOIN iam_team_member owner_member
              ON owner_member.team_id = current_member.team_id
            WHERE current_member.user_id = app_user_id()
              AND owner_member.user_id = record_owner_id
        ) THEN true
        ELSE false
    END;
$$;

CREATE OR REPLACE FUNCTION can_edit_record(
    record_owner_id uuid,
    record_entity_type varchar,
    record_entity_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = marketing_war_map, public
AS $$
    SELECT CASE
        WHEN app_user_id() IS NULL THEN false
        WHEN app_data_scope() = 'ALL' THEN true
        WHEN record_owner_id = app_user_id() THEN true
        WHEN EXISTS (
            SELECT 1
            FROM crm_record_collaborator c
            WHERE c.entity_type = record_entity_type
              AND c.entity_id = record_entity_id
              AND c.user_id = app_user_id()
              AND c.can_edit = true
        ) THEN true
        WHEN app_data_scope() = 'TEAM' AND EXISTS (
            SELECT 1
            FROM iam_team_member current_member
            JOIN iam_team_member owner_member
              ON owner_member.team_id = current_member.team_id
            WHERE current_member.user_id = app_user_id()
              AND owner_member.user_id = record_owner_id
        ) THEN true
        ELSE false
    END;
$$;

ALTER TABLE crm_account ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_contact ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_opportunity ENABLE ROW LEVEL SECURITY;

CREATE POLICY crm_account_select_policy
    ON crm_account FOR SELECT
    USING (can_access_record(owner_user_id, 'ACCOUNT', id));

CREATE POLICY crm_account_insert_policy
    ON crm_account FOR INSERT
    WITH CHECK (app_data_scope() = 'ALL' OR owner_user_id = app_user_id());

CREATE POLICY crm_account_update_policy
    ON crm_account FOR UPDATE
    USING (can_edit_record(owner_user_id, 'ACCOUNT', id))
    WITH CHECK (can_edit_record(owner_user_id, 'ACCOUNT', id));

CREATE POLICY crm_contact_select_policy
    ON crm_contact FOR SELECT
    USING (can_access_record(owner_user_id, 'CONTACT', id));

CREATE POLICY crm_contact_insert_policy
    ON crm_contact FOR INSERT
    WITH CHECK (app_data_scope() = 'ALL' OR owner_user_id = app_user_id());

CREATE POLICY crm_contact_update_policy
    ON crm_contact FOR UPDATE
    USING (can_edit_record(owner_user_id, 'CONTACT', id))
    WITH CHECK (can_edit_record(owner_user_id, 'CONTACT', id));

CREATE POLICY crm_opportunity_select_policy
    ON crm_opportunity FOR SELECT
    USING (can_access_record(owner_user_id, 'OPPORTUNITY', id));

CREATE POLICY crm_opportunity_insert_policy
    ON crm_opportunity FOR INSERT
    WITH CHECK (app_data_scope() = 'ALL' OR owner_user_id = app_user_id());

CREATE POLICY crm_opportunity_update_policy
    ON crm_opportunity FOR UPDATE
    USING (can_edit_record(owner_user_id, 'OPPORTUNITY', id))
    WITH CHECK (can_edit_record(owner_user_id, 'OPPORTUNITY', id));

ALTER TABLE bi_opportunity_daily_snapshot ENABLE ROW LEVEL SECURITY;

CREATE POLICY bi_opportunity_snapshot_select_policy
    ON bi_opportunity_daily_snapshot FOR SELECT
    USING (can_access_record(owner_user_id, 'OPPORTUNITY', opportunity_id));

-- 不创建 DELETE policy：应用层统一执行软删除，物理删除仅允许受控维护账号。

-- -----------------------------------------------------------------------------
-- updated_at 触发器
-- -----------------------------------------------------------------------------

CREATE TRIGGER trg_geo_region_updated_at
BEFORE UPDATE ON geo_region
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_sales_territory_updated_at
BEFORE UPDATE ON sales_territory
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_iam_user_updated_at
BEFORE UPDATE ON iam_user
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_iam_team_updated_at
BEFORE UPDATE ON iam_team
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_iam_role_updated_at
BEFORE UPDATE ON iam_role
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_crm_account_updated_at
BEFORE UPDATE ON crm_account
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_crm_contact_updated_at
BEFORE UPDATE ON crm_contact
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_crm_account_contact_updated_at
BEFORE UPDATE ON crm_account_contact
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_crm_pipeline_updated_at
BEFORE UPDATE ON crm_pipeline
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_crm_pipeline_stage_updated_at
BEFORE UPDATE ON crm_pipeline_stage
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_crm_opportunity_updated_at
BEFORE UPDATE ON crm_opportunity
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_crm_activity_updated_at
BEFORE UPDATE ON crm_activity
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_crm_task_updated_at
BEFORE UPDATE ON crm_task
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_crm_partner_profile_updated_at
BEFORE UPDATE ON crm_partner_profile
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_crm_partner_capability_updated_at
BEFORE UPDATE ON crm_partner_capability
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_crm_delivery_project_updated_at
BEFORE UPDATE ON crm_delivery_project
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_crm_delivery_project_partner_updated_at
BEFORE UPDATE ON crm_delivery_project_partner
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_crm_segment_updated_at
BEFORE UPDATE ON crm_segment
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_meta_custom_field_updated_at
BEFORE UPDATE ON meta_custom_field_definition
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_meta_saved_view_updated_at
BEFORE UPDATE ON meta_saved_view
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_meta_alert_rule_updated_at
BEFORE UPDATE ON meta_alert_rule
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_ops_data_source_updated_at
BEFORE UPDATE ON ops_data_source
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_ops_external_identity_updated_at
BEFORE UPDATE ON ops_external_identity
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- -----------------------------------------------------------------------------
-- 最小初始化角色
-- permission_json 由实际权限字典补齐；角色和数据范围分开，避免只依赖前端菜单。
-- -----------------------------------------------------------------------------

INSERT INTO iam_role (role_code, role_name, data_scope, permission_json)
VALUES
    ('SALES', '销售', 'SELF', '{"account":"edit","opportunity":"edit","import":"self"}'::jsonb),
    ('PRESALES', '售前', 'ALL', '{"account":"read","opportunity":"read","presales_activity":"edit"}'::jsonb),
    ('ADMIN', '管理员', 'ALL', '{"all":"manage"}'::jsonb),
    ('SALES_MANAGER', '销售经理', 'TEAM', '{"team_data":"manage","dashboard":"read"}'::jsonb),
    ('DATA_OPERATOR', '数据运营', 'ALL', '{"master_data":"edit","import":"manage","audit":"read"}'::jsonb)
ON CONFLICT (role_code) DO NOTHING;

COMMENT ON VIEW vw_map_battle_object IS
'统一输出资源、商机和伙伴地图对象；display_category 为五类 UI 图层，object_kind 用于区分客户数与项目数。';

COMMENT ON FUNCTION can_access_record(uuid, varchar, uuid) IS
'行级访问参考函数：支持 ALL、TEAM、SELF 和显式协作者。字段权限仍需由 API 权限层控制。';

COMMENT ON FUNCTION can_edit_record(uuid, varchar, uuid) IS
'行级编辑参考函数：显式协作者只有 can_edit=true 时才允许编辑；负责人、团队经理和 ALL 范围角色按规则放行。';
