-- ============================================================================
-- Let the fleet grow new truck types without a code change (D45). Nate: "give
-- me the option to add a truck type if i need to if we expand." The original
-- CHECK locked equipment_type to F/BT/CV; drop it so the Fleet grid can accept
-- any type Nate types in. Existing F/BT/CV values are unaffected.
-- ============================================================================

alter table trucks drop constraint if exists trucks_equipment_type_check;
