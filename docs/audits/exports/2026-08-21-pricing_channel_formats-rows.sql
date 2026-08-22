-- pricing_channel_formats rows exported before 00294 dropped the table
-- (schema audit 2026-08-21, retirement tracked in #724 / PR #878).
-- 14 (sales_channel_id, format_id) pairs; the superseding table is
-- channel_formats (00285). Restore: recreate the table per 00285 §pricing
-- and run these INSERTs — plain psql, any version.
INSERT INTO public.pricing_channel_formats (sales_channel_id, format_id) VALUES ('7e9a54f5-2cc0-4c53-8efd-d0b2ec2ebaf6', '447e9501-4c0c-4c62-81ba-2d880bf20bf9');
INSERT INTO public.pricing_channel_formats (sales_channel_id, format_id) VALUES ('7e9a54f5-2cc0-4c53-8efd-d0b2ec2ebaf6', '4e33461e-badc-463e-bbdd-554bfba0fbe9');
INSERT INTO public.pricing_channel_formats (sales_channel_id, format_id) VALUES ('7e9a54f5-2cc0-4c53-8efd-d0b2ec2ebaf6', '7c6b400c-50c0-428d-916b-25e29934a65e');
INSERT INTO public.pricing_channel_formats (sales_channel_id, format_id) VALUES ('513147e4-b692-4155-905e-744b72eadc89', '447e9501-4c0c-4c62-81ba-2d880bf20bf9');
INSERT INTO public.pricing_channel_formats (sales_channel_id, format_id) VALUES ('513147e4-b692-4155-905e-744b72eadc89', '4e33461e-badc-463e-bbdd-554bfba0fbe9');
INSERT INTO public.pricing_channel_formats (sales_channel_id, format_id) VALUES ('513147e4-b692-4155-905e-744b72eadc89', '7c6b400c-50c0-428d-916b-25e29934a65e');
INSERT INTO public.pricing_channel_formats (sales_channel_id, format_id) VALUES ('2ee7d876-cf93-4eeb-8b3c-76c8b307f0b4', '447e9501-4c0c-4c62-81ba-2d880bf20bf9');
INSERT INTO public.pricing_channel_formats (sales_channel_id, format_id) VALUES ('2ee7d876-cf93-4eeb-8b3c-76c8b307f0b4', '6fa8f07f-533b-407d-98c9-f5b3f0b39e1c');
INSERT INTO public.pricing_channel_formats (sales_channel_id, format_id) VALUES ('0264e0af-5b1c-4eba-9d2a-a0d8d5659319', 'a957a0bf-40b6-440c-82a5-4b6f4d907bf2');
INSERT INTO public.pricing_channel_formats (sales_channel_id, format_id) VALUES ('0264e0af-5b1c-4eba-9d2a-a0d8d5659319', '6fa8f07f-533b-407d-98c9-f5b3f0b39e1c');
INSERT INTO public.pricing_channel_formats (sales_channel_id, format_id) VALUES ('0264e0af-5b1c-4eba-9d2a-a0d8d5659319', '4abcc414-9e19-4134-86b9-c3607478b51e');
INSERT INTO public.pricing_channel_formats (sales_channel_id, format_id) VALUES ('0264e0af-5b1c-4eba-9d2a-a0d8d5659319', '7a3d2072-034f-43f5-8be6-581906f79d35');
INSERT INTO public.pricing_channel_formats (sales_channel_id, format_id) VALUES ('0264e0af-5b1c-4eba-9d2a-a0d8d5659319', '8103e019-7631-4d97-8b5d-3f0157decc28');
INSERT INTO public.pricing_channel_formats (sales_channel_id, format_id) VALUES ('0264e0af-5b1c-4eba-9d2a-a0d8d5659319', 'd050abbb-263f-428c-85f7-89f4f8c309d9');
