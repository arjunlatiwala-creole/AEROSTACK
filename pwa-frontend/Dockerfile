FROM node:latest

# intentional bad practice: secrets in ENV
ENV AWS_ACCESS_KEY_ID="AKIAIOSFODNN7EXAMPLE"
ENV AWS_SECRET_ACCESS_KEY="wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"

WORKDIR /app
COPY . .

# intentional bad practice: curl | bash
RUN curl -sL https://deb.nodesource.com/setup_18.x | bash - && \
    apt-get install -y nodejs

RUN npm install

EXPOSE 3000

# intentional bad practice: running as root (no USER directive)
CMD ["npm", "start"]
