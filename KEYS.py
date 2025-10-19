from alpaca_trade_api.rest import REST
from alpaca_trade_api.rest import REST, TimeFrame
from dotenv import load_dotenv
import os

# Load environment variables
load_dotenv()

API_KEY = os.getenv("API_KEY")
API_SECRET = os.getenv("API_SECRET")
BASE_URL = os.getenv("BASE_URL")

api = REST(API_KEY, API_SECRET, BASE_URL)

# Account info
account = api.get_account()
print(f"Account status: {account.status}")
print(f"Cash available: ${account.cash}")

# Get latest trade
last_trade = api.get_latest_trade("AAPL")
print(f"Last AAPL trade price: ${last_trade.price}")

# Get recent 5 one-minute bars
bars = api.get_bars("AAPL", TimeFrame.Minute, limit=5)
for bar in bars:
    print(f"{bar.t}: Open={bar.o}, Close={bar.c}")
