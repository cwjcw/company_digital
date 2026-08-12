import { MigrationInterface, QueryRunner } from "typeorm";

export class PlanPeriodAlignment1722920006000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "order_items" item
      SET "source_month" = period."month"
      FROM "plan_periods" period
      WHERE item."period_id" = period."id"
        AND item."source_month" IS DISTINCT FROM period."month"
    `);
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION create_monthly_plan(target_year integer, target_month integer)
      RETURNS uuid LANGUAGE plpgsql AS $$
      DECLARE new_period uuid; previous_period uuid;
      BEGIN
        INSERT INTO plan_periods(year, month, status) VALUES(target_year, target_month, 'active')
        ON CONFLICT(year, month) DO UPDATE SET status=EXCLUDED.status RETURNING id INTO new_period;
        SELECT id INTO previous_period FROM plan_periods
        WHERE (year * 12 + month) < (target_year * 12 + target_month)
        ORDER BY year DESC, month DESC LIMIT 1;
        IF previous_period IS NULL THEN RETURN new_period; END IF;
        INSERT INTO order_items(
          order_id, period_id, item_number, relation_key, item_name,
          customer_due_date, review_due_date, exception_due_date, exception_delivery_method,
          customer, division, container_date, model_age, image_refs,
          product_attribute, surface_nature, special_item, production_quantity, historical_inbound_quantity,
          today_inbound_quantity, handling_method, plan_page, order_exception, inspection,
          inspection_quantity, remark, order_weeks, source_month, unit_price, active, version
        )
        SELECT
          order_id, new_period, item_number, relation_key, item_name,
          customer_due_date, review_due_date, exception_due_date, exception_delivery_method,
          customer, division, container_date, model_age, image_refs,
          product_attribute, surface_nature, special_item,
          GREATEST(COALESCE(production_quantity,0)-COALESCE(historical_inbound_quantity,0)-COALESCE(today_inbound_quantity,0),0),
          0, 0, handling_method, plan_page, order_exception, inspection, inspection_quantity,
          remark, order_weeks, target_month, unit_price, true, 1
        FROM order_items
        WHERE period_id=previous_period AND active=true
          AND COALESCE(production_quantity,0)-COALESCE(historical_inbound_quantity,0)-COALESCE(today_inbound_quantity,0) > 0
        ON CONFLICT(period_id, order_id, item_number) DO NOTHING;
        RETURN new_period;
      END $$;
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION create_monthly_plan(target_year integer, target_month integer)
      RETURNS uuid LANGUAGE plpgsql AS $$
      DECLARE new_period uuid; previous_period uuid;
      BEGIN
        INSERT INTO plan_periods(year, month, status) VALUES(target_year, target_month, 'active')
        ON CONFLICT(year, month) DO UPDATE SET status=EXCLUDED.status RETURNING id INTO new_period;
        SELECT id INTO previous_period FROM plan_periods
        WHERE (year * 12 + month) < (target_year * 12 + target_month)
        ORDER BY year DESC, month DESC LIMIT 1;
        IF previous_period IS NULL THEN RETURN new_period; END IF;
        INSERT INTO order_items(
          order_id, period_id, item_number, relation_key, item_name, container_date, model_age, image_refs,
          product_attribute, surface_nature, special_item, production_quantity, historical_inbound_quantity,
          today_inbound_quantity, handling_method, plan_page, order_exception, inspection,
          inspection_quantity, remark, order_weeks, source_month, unit_price, active, version
        )
        SELECT order_id, new_period, item_number, relation_key, item_name, container_date, model_age, image_refs,
          product_attribute, surface_nature, special_item,
          GREATEST(COALESCE(production_quantity,0)-COALESCE(historical_inbound_quantity,0)-COALESCE(today_inbound_quantity,0),0),
          0, 0, handling_method, plan_page, order_exception, inspection, inspection_quantity,
          remark, order_weeks, target_month, unit_price, true, 1
        FROM order_items
        WHERE period_id=previous_period AND active=true
          AND COALESCE(production_quantity,0)-COALESCE(historical_inbound_quantity,0)-COALESCE(today_inbound_quantity,0) > 0
        ON CONFLICT(period_id, order_id, item_number) DO NOTHING;
        RETURN new_period;
      END $$;
    `);
  }
}
