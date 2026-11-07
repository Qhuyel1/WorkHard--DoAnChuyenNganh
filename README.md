# WorkHard
Ứng dụng tiếng Việt cho chủ cửa hàng. Quản lý sản phẩm theo đơn vị tùy chọn, đơn vị đóng gói hoặc cuộn có khổ cố định. Hỗ trợ nhập kho, bán nhiều mặt hàng trong một hóa đơn, thu tiền mặt, QR, bán chịu, thu nợ, lịch sử, in phiếu và báo cáo theo kỳ.

## Chạy trên máy
Cài Node.js 22.13 trở lên và npm. Giải nén rồi mở Terminal trong thư mục dự án.

1. Chạy `npm ci`.
2. Chạy `npm run build` để tạo cấu hình máy chủ.
3. Khởi tạo cơ sở dữ liệu cục bộ bằng lệnh dưới đây (chạy một lần trên macOS/Linux).

```bash
for sql in drizzle/*.sql; do
  node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file "$sql" || break
done
```

4. Chạy `npm run dev` và mở địa chỉ Terminal hiển thị. Dữ liệu cục bộ lưu trong `.wrangler/state`. Dữ liệu website đã triển khai nằm trong cơ sở dữ liệu riêng.

## Dùng thử
Trong **Kho hàng**, tạo mặt hàng với đơn vị kg và đơn vị đóng gói bao, hệ số 25. Nhập 1 bao, sau đó bán 2,5 kg. Nếu bán chịu, chọn khách hàng, điền số thu ngay và xác nhận. Mở hóa đơn từ lịch sử để in hoặc thu nợ. Trong **Báo cáo**, chọn kỳ và ngày muốn tra cứu.

Đối với hàng cuộn, nhập chiều rộng một lần khi tạo sản phẩm, mỗi lần nhập một cuộn. Khi bán, chọn cuộn và chiều dài cần cắt. Hệ thống tính diện tích và trừ chiều dài trên cuộn đã chọn.

Để hiện QR, vào **Thiết lập QR** lưu mã ngân hàng và số tài khoản. Ảnh QR được tạo qua VietQR. Chủ cửa hàng kiểm tra tiền vào tài khoản trước khi xác nhận.

## Mã nguồn chính
- `public/shop-62c9880b1863.js` giao diện và nghiệp vụ cửa hàng.
- `app/globals.css` bố cục, hiển thị di động và bản in.
- `app/api/ledger/route.ts` đọc/ghi sổ cửa hàng, khóa phiên bản khi cập nhật đồng thời.
- `db/schema.ts`, `drizzle/` cấu trúc và migration D1.
- `app/page.tsx`, `app/layout.tsx` khởi tạo giao diện.

Bản triển khai được thiết kế cho một chủ cửa hàng với quyền truy cập riêng tư. Chạy local dành cho phát triển trên máy cá nhân.

**Lãi gộp** bằng doanh thu trừ giá vốn của lượng đã bán. Hàng thông thường xuất trước theo thứ tự nhập, hàng cuộn lấy giá vốn trên cuộn đã chọn. Báo cáo tính theo ngày bán, kể cả đơn còn nợ.
