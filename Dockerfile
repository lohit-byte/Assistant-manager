FROM python:3.11-slim
WORKDIR /app

# 1. Copy requirements from the root of the repo
COPY requirements.txt .

# 2. Install the packages
RUN pip install --no-cache-dir -r requirements.txt

# 3. Copy the rest of the bot code (main.py, cogs, etc.)
COPY bot/ .

# 4. Run the bot
CMD ["python", "main.py"]
