-- Move legacy single-user data to the alexander profile.
UPDATE app_state SET device_id = 'alexander' WHERE device_id = 'default';
UPDATE habits_bundle SET device_id = 'alexander' WHERE device_id = 'default';
UPDATE macro_bundle SET device_id = 'alexander' WHERE device_id = 'default';
UPDATE lift_bundle SET device_id = 'alexander' WHERE device_id = 'default';
UPDATE lift_assumption SET device_id = 'alexander' WHERE device_id = 'default';
