#!/bin/sh

# inject env. variables from env properties file
set -a
. ${WORKSPACE}/local_env.properties
set +a

crc_started() {
    openshiftStatus=$(./crc status | grep OpenShift | awk -F: '{ print $2 }' | tr -d " ")
    crcStatus=$(./crc status | grep "CRC VM:" | awk -F: '{ print $2 }' | tr -d " ")
    result=0
    if [[ $openshiftStatus == *Running* ]] && [[ $crcStatus == *Running* ]]; then
        result=1
    fi
    echo $result
}

operator_deployed() {
    operator_deployed=`oc get csv | grep -i "serverless-operator" | cut -c $(oc get csv | grep -b -o PHASE | cut -d: -f1)- | cut -d' ' -f2 | tail -n 1`
    result=0
    if [[ $operator_deployed == *Succeeded* ]]; then
        result=1
    fi
    echo $result
}

eventing_deployed() {

    for condition in `oc get knativeeventing.operator.knative.dev/knative-eventing \
  -n knative-eventing \
  --template='{{range .status.conditions}}{{printf "%s=%s\\n" .type .status}}{{end}}'`; do
        status=$(echo $condition | cut -d= -f2)
        if [ $status == "True" ]; then
            result=1
        else
            result=0
            break;
        fi
    done
    echo $result
}

serving_deployed() {

    for condition in `oc get knativeserving/knative-serving -n knative-serving --template='{{range .status.conditions}}{{printf "%s=%s\\n" .type .status}}{{end}}'`; do
        status=$(echo $condition | cut -d= -f2)
        if [ $status == "True" ]; then
            result=1
        else
            result=0
            break;
        fi
    done
    echo $result
}



cd ${WORKSPACE2}/crc

## Start crc and install all necessary stuff

./${BASEFILE_NAME} start -p ${CRC_PULL_SECRET} --memory 18432 --cpus 6

./${BASEFILE_NAME} status || true

# verify crc is started
echo "CRC is starting..."
treshold=240
timer=0
starting_result="CRC is started and ready"
while [ "$(crc_started)" != "1" ]; do
    echo "waiting for $timer sec..."
    sleep 10
    ((timer=timer+10))
    if [ $timer -ge $treshold ]; then
        starting_result="Timeout reached when starting CRC"
        echo $starting_result
        exit 1
    fi
done

echo $starting_result

# add oc to the path
./${BASEFILE_NAME} oc-env
eval $(./${BASEFILE_NAME} oc-env)

oc version

# log into a cluster using oc
# password can be obtained from ~/.crc/cache/crc_libvirt_4.5.1/kubeadmin-password
# 4.5.1 string can be get from ./crc version or from client version: oc version
pass=`cat ~/.crc/cache/crc_libvirt_$(oc version | head -n 1 | cut -d':' -f2 | xargs)/kubeadmin-password`
oc login -u kubeadmin -p ${pass} https://api.crc.testing:6443 --insecure-skip-tls-verify

# to list available operators
oc get packagemanifests -n openshift-marketplace

# we are searching for serverless operator: serverless-operator
oc describe packagemanifests serverless-operator -n openshift-marketplace

# Switch to openshift
# Create a subscription yaml object - look for spec part in installed opeator to find installCSV, etc...
cat >> subscription-serverless.yaml <<EOL
apiVersion: operators.coreos.com/v1alpha1
kind: Subscription
metadata:
  name: serverless-operator
  namespace: openshift-operators 
spec:
  channel: '4.5'
  installPlanApproval: Automatic
  name: serverless-operator
  source: redhat-operators
  sourceNamespace: openshift-marketplace
  startingCSV: serverless-operator.v1.7.2
EOL

# apply subscription
oc apply -f subscription-serverless.yaml

# change to default project - openshift-operators
oc project openshift-operators
# Verification of installed operators:
oc get subscriptions
# serverless-operator   serverless-operator   redhat-operators   4.5
oc get csv

echo "Serverless Operator is deploying..."

treshold=240
timer=0
while [ "$(operator_deployed)" != "1" ]; do
    echo "waiting for $timer sec..."
    sleep 30
    ((timer=timer+30))
    if [ $timer -ge $treshold ]; then
        echo "Timeout reached when deploying Serverless operator"
        exit 1
    fi
done

echo "Serverless operator is deployed"

# Create a namespace and install knative serving
oc create namespace knative-serving

# Install Knative Serving
cat > serving.yaml << EOL
apiVersion: operator.knative.dev/v1alpha1
kind: KnativeServing
metadata:
 name: knative-serving
 namespace: knative-serving
EOL

# apply
oc apply -f serving.yaml

# KNative Serving deploying status
oc get knativeserving/knative-serving -n knative-serving --template='{{range .status.conditions}}{{printf "%s=%s\\n" .type .status}}{{end}}'
oc get pods -n knative-serving

echo "Knative serving is deploying..."

treshold=300
timer=0
deploying_result="KNative Serving is deployed"
while [ "$(serving_deployed)" != "1" ]; do
    echo "waiting for $timer sec..."
    sleep 30
    ((timer=timer+30))
    if [ $timer -ge $treshold ]; then
        deploying_result="Timeout reached when deploying KNative Serving, continue anyway"
        break
    fi
done

echo $deploying_result

# Install Knative Eventing

# Create a namespace and install KNative eventing
oc create namespace knative-eventing

cat > eventing.yaml << EOL
apiVersion: operator.knative.dev/v1alpha1
kind: KnativeEventing
metadata:
  name: knative-eventing
  namespace: knative-eventing
EOL

oc apply -f eventing.yaml

# Check KNative Eventing deploying
oc get knativeeventing.operator.knative.dev/knative-eventing \
  -n knative-eventing \
  --template='{{range .status.conditions}}{{printf "%s=%s\\n" .type .status}}{{end}}'
oc get pods -n knative-eventing

echo "Knative eventing is deploying..."

treshold=300
timer=0
deploying_result="KNative Eventing is deployed"
while [ "$(serving_deployed)" != "1" ]; do
    echo "waiting for $timer sec..."
    sleep 30
    ((timer=timer+30))
    if [ $timer -ge $treshold ]; then
        deploying_result="Timeout reached when deploying KNative Eventing, continue anyway"
        break
    fi
done

echo $deploying_result

# Create new project for knative tutorial examplea app
oc new-project another-serverless-example