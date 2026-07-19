# PROVIDERS

This file contains list of property providers. 

All providers are listed in the Provider List below, sorted alphanumerically. 
Providers are auction sites (ex: Crexi), site (ex: Crexi, loopnet), residential sites (ex: Zillow) CRE brokers, and listing agents. 
They provide deals via email, website or an API. 


## Provider List 
- [x] **Cushman & Wakefield** - Info@cwmultifamily.com — email parser + portal detail fetcher live (see auctions/email/README.md)
- [x] **Marcus & Millichap Auction Services** - mmauctions@marcusmillichap.com — email parser live (auction listings; RIM portal detail fetcher is a future step)
- [x] **Auction.com** - notifications@adc.auction.com — archive-only parser live (same inventory as the auction_com scraper; emails are deduped away and moved to Gmail Trash)
- [x] **Boulder Group** - listings@bouldergroup.com — parser live; also matches emails@campaigns.crexi.com when the display name is "The Boulder Group"
- [x] **Central Valley Investment Team** - jake.king@colliers.com / Adam Lucatello — parser live (image-only blasts: parsed from subject + mailto property name; closed listings and newsletters skipped)
- [x] **Elevate Net Lease** info@elevatenla.ccsend.com — parser live (full street addresses; JUST CLOSED skipped)
- [x] **Cody Smith & Robert Dulin** csmith@kisergroup.com — parser live (stable kisergroup.com propertyId as source_id)
- [x] **The Wallet Wise Team** info-thewalletwise.com@shared1.ccsend.com — parser live (hotels; property_types Hospitality)
- [x] **cbre@rcm1.com** cbre@rcm1.com — parser live (unpriced institutional multifamily; tour re-blasts dedupe on units+city)
- [x] **visintainergroup.ccsend.com** john@visintainergroup.ccsend.com — parser live (image-only blasts parsed from subject; Market Tracker + For Closed skipped)
