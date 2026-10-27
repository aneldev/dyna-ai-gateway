import {IKbDocument} from "../../..";

// The knowledge base of the eval: the handbook of a made-up bookshop, "Nordwind Books".
// Every fact in it is invented, so a model cannot know it from its training: an answer can only come from the chunks.
// Each section is long enough (over 100 tokens) to be a chunk of its own with the default MdChunker settings.

const makeDoc = (id: string, title: string, markdown: string): IKbDocument => ({
  id,
  bookId: "handbook",
  libraryId: "nordwind",
  title,
  markdown,
  tags: [],
  language: "en",
});

export const kbEvalDocuments: IKbDocument[] = [
  makeDoc("refunds", "Refunds", `
# Time limits
A customer of Nordwind Books can ask for a refund within 34 days of the delivery date. The day the parcel arrives counts as day zero. For a book that arrives damaged or with printing errors the period is much longer: such a book can be returned within 14 months. After these periods the shop does not refund, but the customer service may offer a voucher as a gesture of goodwill, which the team lead has to approve.

# How to request a refund
A refund is requested with the form R-12, which is found in the customer account under "My orders". The form needs the order number and the reason for the return; photos are required only for damaged items. The request is confirmed by email within two working days. Requests by phone are not accepted, because the shop needs a written record of every return for its bookkeeping.

# What is paid back
The price of the returned books is paid back in full. The shipping fee of the original order is paid back only when the reason for the return is a mistake of the shop, for example a wrong or damaged book. The customer pays the postage of the return parcel, unless the shop sent a prepaid return label. Gift wrapping is never paid back, because the service was already delivered.

# How the money is returned
The money always goes back the same way it came: to the same credit card, bank account or wallet that paid for the order. After the returned parcel was checked in the warehouse, the transfer takes between six and nine working days. A customer who paid with a gift card gets the amount back as credit on that gift card and not as money.

# What cannot be refunded
Some products are excluded from refunds. E-books and audio downloads cannot be returned once the download has started. Gift cards are never refunded. Books with a personal dedication printed on request, magazines and newspapers are excluded as well. Sealed language courses on CD can only be returned while the seal is unbroken.
`),
  makeDoc("invoices", "Invoices", `
# Invoice numbers
Every invoice of Nordwind Books has a number of the form NW, the year and a six-digit counter, for example NW-2026-004217. The counter starts again at 000001 on the first of January. Numbers are given by the system in the order of creation and no number may be skipped or used twice; an invoice that was created by mistake is cancelled with a credit note and keeps its number.

# Correcting an invoice
An invoice that was sent is never edited. When an invoice has a mistake, for example a wrong address or a wrong amount, the accountant creates a credit note that cancels it completely and then issues a new invoice with a new number. The credit note names the number of the invoice it cancels. Small spelling mistakes in the name of a customer are corrected the same way.

# Payment terms
Business customers pay within 21 days of the invoice date. Whoever pays within eight days may deduct an early payment discount of 3 percent. Private customers pay at the time of the order, so their invoices are already marked as paid. A different payment period can be agreed in a framework contract, and it is then printed on every invoice of that customer.

# Late payment
When a business customer has not paid 21 days after the invoice date, the system sends a first reminder without a fee. The second reminder follows ten days later and adds a reminder fee of 12 euros. From the 45th day the shop charges interest of 9 percent per year on the open amount and stops delivering new orders to that customer until the invoice is paid.

# Sending invoices
Invoices are sent as PDF files by email on the day the parcel leaves the warehouse. A printed invoice by post is possible on request and costs 2.50 euros per invoice. Customers with a business account find all their invoices of the last ten years in the portal under "Documents" and can download them there at any time, alone or as one archive per year.
`),
  makeDoc("expenses", "Staff expenses", `
# Business trips
Employees travel by train in second class. A flight is allowed only when the train journey would take longer than five hours, and it has to be booked in economy class through the travel desk. A hotel may cost up to 140 euros per night, in capital cities up to 185 euros. A taxi is paid only between 22:00 and 6:00 or when no public transport runs.

# Meals on a trip
For meals on a business trip the company pays a fixed daily allowance and not the actual bills. The allowance is 38 euros for a full day away and 19 euros for a day of travel that lasts between eight and fourteen hours. When breakfast is included in the hotel price, the allowance of that day is reduced by 7 euros.

# Using a private car
An employee who uses a private car for a business trip gets 0.46 euros for each kilometre driven. The route has to be noted in the trip report with the start, the destination and the reason. Parking fees and road tolls are paid in addition when a receipt exists. Fines for speeding or wrong parking are never paid by the company.

# Handing in receipts
Expenses are handed in through the expense tool as a photo of the receipt. A receipt is required for every amount above 15 euros; below that a short note is enough. The claim has to be made within 75 days of the expense, later claims are refused. The money is paid with the next salary when the claim was approved before the 10th of the month.

# Who approves expenses
Every expense claim is approved by the direct manager. A single expense above 600 euros needs a second approval by the head of finance before it is paid. Managers cannot approve their own claims; these go to the next level. Purchases of equipment such as laptops or phones are not expenses at all and have to be ordered through the IT department.
`),
  makeDoc("app", "Using the Nordwind portal", `
# Resetting a password
A user who forgot the password clicks "Forgot password" on the login page and enters the email address of the account. The portal sends a link that is valid for 25 minutes and can be used once. The new password needs at least twelve characters, with a number and a special character. After five wrong attempts the account is locked for one hour.

# Two-step login
The portal can ask for a second step at login. It is switched on under "Profile", "Security". The second step is a six-digit code from an authenticator app on the phone; codes by SMS are not supported. When the phone is lost, one of the ten backup codes that were shown at setup can be used instead, each of them only once.

# Exporting data
Tables of orders, invoices and customers can be exported from the menu "Reports", "Export". The export is a CSV file with a semicolon as separator and dates in the form year, month, day. An export can contain at most 50,000 rows; larger exports have to be split by date range. The file is ready in the download area for 48 hours.

# User roles
The portal has three roles. An administrator manages users and settings. An accountant sees and edits invoices, credit notes and payments, but cannot change settings. A viewer can only read and export. A user has exactly one role, and only an administrator can change it. Every company account needs at least one administrator at all times.

# Automatic logout
For safety the portal logs a user out after 18 minutes without activity. Text that was typed into a form but not saved is kept as a draft for 24 hours and is offered again after the next login. On a shared computer the user should always log out by hand; the option "Stay logged in" keeps the session for 30 days on that device.
`),
  makeDoc("shipping", "Shipping and delivery", `
# Delivery times
A parcel inside the country arrives two to three working days after the order. To other countries of the European Union it takes five to eight working days, to the rest of the world up to four weeks. Orders that arrive in the warehouse before 13:00 leave it on the same day. Books that are printed on demand need six additional days.

# Shipping costs
Shipping inside the country costs 3.90 euros per order. From an order value of 45 euros the shipping is free. To the European Union the fee is 9.50 euros, and it is never free. Heavy orders above 20 kilograms are sent by a freight company and their cost is calculated in the basket before the customer pays.

# Tracking a parcel
When the parcel leaves the warehouse, the customer gets an email with the tracking number of the carrier. The link in the email shows where the parcel is. The tracking becomes active a few hours after the parcel was handed over. If the status has not changed for six working days, the customer service starts a search with the carrier.

# Damaged parcels
A parcel that arrives damaged has to be reported within three days of delivery. The report needs photos of the outer box, of the label and of the damaged books. The customer should keep the packaging until the case is closed. The shop sends a replacement at once and does not wait for the result of the claim with the carrier.

# Changing the delivery address
The delivery address of an order can be changed in the customer account as long as the order has the status "In preparation". Once the parcel was handed to the carrier the shop cannot change the address any more; the customer can then redirect the parcel on the website of the carrier, which may cost a fee of the carrier.
`),
  makeDoc("data", "Data protection", `
# How long data is kept
Invoices, credit notes and payment records are kept for eleven years, as the tax law of the country requires. Orders without an invoice, for example cancelled baskets, are deleted after 90 days. The messages a customer wrote to the customer service are kept for three years after the last contact and are then removed automatically.

# Deleting a customer account
A customer can ask for the deletion of the account at any time, in the account settings or by a message to the data protection officer. The request is carried out within 20 days. The personal data is deleted, but invoices stay in the bookkeeping with the name and address they were issued to, because the law requires it.

# Backups
The databases of the shop are saved every night at 2:30. The nightly backups are kept for 40 days. In addition a full backup is made on the first day of each month and kept for one year. Backups are stored encrypted in a second data centre, at least 200 kilometres away from the first one.

# Who may see customer data
Customer data is visible only to the employees who need it for their work. The customer service sees orders and addresses, but only the last four digits of a card number. The marketing team sees no names at all and works with anonymous numbers. Every access to a customer record is written to a log that is kept for 120 days.

# Newsletter
The newsletter is sent only to customers who confirmed it with the link in the confirmation email. Every newsletter has a link at its end that cancels it with one click. A cancelled address is removed from the mailing list within 24 hours. The shop does not buy address lists and does not pass addresses on to other companies.
`),
];
