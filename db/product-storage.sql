-- Product images are public; uploads require server-managed administrator claims.
INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES('product-images','product-images',true,3145728,ARRAY['image/webp'])
ON CONFLICT(id) DO UPDATE SET public=true,file_size_limit=3145728,allowed_mime_types=ARRAY['image/webp'];
DROP POLICY IF EXISTS product_images_admin_insert ON storage.objects;
CREATE POLICY product_images_admin_insert ON storage.objects FOR INSERT TO authenticated
WITH CHECK(bucket_id='product-images' AND (storage.foldername(name))[1]=auth.uid()::text AND
 EXISTS(SELECT 1 FROM public.profiles WHERE id=auth.uid() AND status='active') AND
 ((auth.jwt()->'app_metadata'->>'adminConsole')='true' OR (auth.jwt()->'app_metadata'->>'adminRole')='SUPER_ADMIN'));
