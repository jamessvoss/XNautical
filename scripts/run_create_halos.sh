#!/bin/bash
# Run the halo creation script in a virtual environment

cd "$(dirname "$0")/.."

echo "Setting up Python virtual environment..."
python3 -m venv .venv
source .venv/bin/activate

echo "Installing Pillow..."
pip install Pillow

echo ""
echo "Running halo creation script..."
python scripts/create_all_halos.py

deactivate
echo ""
echo "Virtual environment cleaned up."
